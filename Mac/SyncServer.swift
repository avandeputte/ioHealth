import Foundation
import Network

/// Listens on a fixed TCP port (so the iPhone can also be given the address by hand), advertises it over Bonjour,
/// and feeds each NDJSON line from the iPhone to `onMessage`.
/// One connection at a time; a second phone connecting while one is syncing is refused.
final class SyncServer {
    typealias MessageHandler = (SyncMessage) throws -> Void

    private var listener: NWListener?
    private var active: NWConnection?
    private let queue: DispatchQueue
    private let onMessage: MessageHandler
    private let onEvent: (Event) -> Void

    enum Event {
        case listening(port: UInt16)
        case connected(peer: String)
        case disconnected
        case failed(Error)
    }

    /// `queue` runs every callback, including `onMessage`, `onEvent` and `countForAck`.
    init(queue: DispatchQueue, onMessage: @escaping MessageHandler, onEvent: @escaping (Event) -> Void) {
        self.queue = queue
        self.onMessage = onMessage
        self.onEvent = onEvent
    }

    func start(serviceName: String, port: UInt16 = SyncProtocol.defaultPort) throws {
        let params = NWParameters.tcp
        params.includePeerToPeer = true
        let l = try NWListener(using: params, on: NWEndpoint.Port(rawValue: port) ?? .any)
        l.service = NWListener.Service(name: serviceName, type: SyncProtocol.bonjourType)
        l.stateUpdateHandler = { [weak self] state in
            switch state {
            case .ready: self?.onEvent(.listening(port: l.port?.rawValue ?? 0))
            case .failed(let e): self?.onEvent(.failed(e))
            default: break
            }
        }
        l.newConnectionHandler = { [weak self] conn in self?.accept(conn) }
        l.start(queue: queue)
        listener = l
    }

    func stop() {
        active?.cancel()
        listener?.cancel()
    }

    private func accept(_ conn: NWConnection) {
        guard active == nil else { conn.cancel(); return }
        active = conn
        var peer = "iPhone"
        if case .hostPort(let host, _) = conn.endpoint { peer = "\(host)" }
        conn.stateUpdateHandler = { [weak self] state in
            switch state {
            case .ready: self?.onEvent(.connected(peer: peer))
            case .failed(let e): self?.finish(conn); self?.onEvent(.failed(e))
            case .cancelled: self?.finish(conn)
            default: break
            }
        }
        conn.start(queue: queue)
        receive(on: conn, carry: Data())
    }

    private func finish(_ conn: NWConnection) {
        guard active === conn else { return }
        active = nil
        onEvent(.disconnected)
    }

    private func receive(on conn: NWConnection, carry: Data) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 1 << 20) { [weak self] data, _, isComplete, error in
            guard let self else { return }
            var buffer = carry
            if let data { buffer.append(data) }

            // Split on newlines; the tail after the last newline is an incomplete line, kept for the next read.
            var start = buffer.startIndex
            while let nl = buffer[start...].firstIndex(of: 0x0A) {
                let line = buffer[start..<nl]
                start = buffer.index(after: nl)
                if line.isEmpty { continue }
                do {
                    let msg = try JSONDecoder.sync.decode(SyncMessage.self, from: line)
                    try self.onMessage(msg)
                    if case .done = msg {
                        self.sendAck(on: conn)
                        return
                    }
                } catch {
                    self.onEvent(.failed(error))
                    conn.cancel()
                    return
                }
            }
            let rest = Data(buffer[start...])

            if let error { self.onEvent(.failed(error)); conn.cancel(); return }
            if isComplete { conn.cancel(); return }
            self.receive(on: conn, carry: rest)
        }
    }

    /// Reported count is whatever the database says it has, so the phone's "done" screen reflects the real tally.
    var countForAck: () -> Int = { 0 }

    private func sendAck(on conn: NWConnection) {
        var data = (try? JSONEncoder.sync.encode(SyncMessage.ack(received: countForAck()))) ?? Data()
        data.append(0x0A)
        conn.send(content: data, completion: .contentProcessed { _ in
            conn.cancel()
        })
    }
}
