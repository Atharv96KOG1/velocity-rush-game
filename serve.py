"""Local server for Velocity Rush.

Serves the game with caching disabled and runs a small WebSocket relay at /relay,
so players on the same network can race without peer-to-peer connections.

Usage: python3 serve.py [port]   then open http://localhost:8000
Friends on your Wi-Fi open http://<your-computer's-IP>:8000
"""
import base64
import hashlib
import http.server
import json
import os
import random
import socket
import struct
import sys
import threading

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC11B65"
CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

rooms = {}          # code -> {"host": Client, "clients": {cid: Client}, "next": int}
rooms_lock = threading.Lock()


class Client:
    def __init__(self, sock):
        self.sock = sock
        self.lock = threading.Lock()
        self.room = None
        self.cid = None   # None for the host

    def send(self, obj):
        data = json.dumps(obj, separators=(",", ":")).encode()
        n = len(data)
        if n < 126:
            header = struct.pack("!BB", 0x81, n)
        elif n < 65536:
            header = struct.pack("!BBH", 0x81, 126, n)
        else:
            header = struct.pack("!BBQ", 0x81, 127, n)
        try:
            with self.lock:
                self.sock.sendall(header + data)
        except OSError:
            pass


def recv_exact(sock, n):
    buf = b""
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError
        buf += chunk
    return buf


def read_frame(sock):
    """Returns (opcode, payload). Handles fragmented text messages."""
    message, first_op = b"", None
    while True:
        b1, b2 = recv_exact(sock, 2)
        fin, opcode = b1 & 0x80, b1 & 0x0F
        length = b2 & 0x7F
        if length == 126:
            length = struct.unpack("!H", recv_exact(sock, 2))[0]
        elif length == 127:
            length = struct.unpack("!Q", recv_exact(sock, 8))[0]
        mask = recv_exact(sock, 4) if b2 & 0x80 else b"\0\0\0\0"
        payload = bytes(b ^ mask[i % 4] for i, b in enumerate(recv_exact(sock, length)))
        if opcode >= 0x8:              # control frames are never fragmented
            return opcode, payload
        if first_op is None:
            first_op = opcode
        message += payload
        if fin:
            return first_op, message


def handle(client, msg):
    op = msg.get("op")
    if op == "host":
        with rooms_lock:
            code = "".join(random.choice(CODE_CHARS) for _ in range(5))
            while code in rooms:
                code = "".join(random.choice(CODE_CHARS) for _ in range(5))
            rooms[code] = {"host": client, "clients": {}, "next": 1}
            client.room = code
        client.send({"op": "hosted", "code": code})
    elif op == "join":
        code = str(msg.get("code", "")).upper()
        with rooms_lock:
            room = rooms.get(code)
            if room:
                cid = "c%d" % room["next"]
                room["next"] += 1
                room["clients"][cid] = client
                client.room, client.cid = code, cid
        if not room:
            client.send({"op": "error", "reason": "Room %s not found on this server." % code})
            return
        client.send({"op": "joined", "code": code})
        room["host"].send({"op": "peer", "cid": cid})
    elif client.room in rooms:
        room = rooms[client.room]
        if client.cid is None:         # host -> one client or everyone
            if op == "to" and msg.get("cid") in room["clients"]:
                room["clients"][msg["cid"]].send({"op": "data", "d": msg.get("d")})
            elif op == "all":
                for c in list(room["clients"].values()):
                    c.send({"op": "data", "d": msg.get("d")})
        elif op == "up":               # client -> host
            room["host"].send({"op": "from", "cid": client.cid, "d": msg.get("d")})


def disconnect(client):
    with rooms_lock:
        room = rooms.get(client.room)
        if not room:
            return
        if client.cid is None:
            del rooms[client.room]
            for c in room["clients"].values():
                c.send({"op": "closed"})
        else:
            room["clients"].pop(client.cid, None)
            room["host"].send({"op": "gone", "cid": client.cid})


class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"   # browsers reject a WebSocket upgrade answered as HTTP/1.0

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path == "/relay" and self.headers.get("Upgrade", "").lower() == "websocket":
            return self.websocket()
        return super().do_GET()

    def websocket(self):
        key = self.headers["Sec-WebSocket-Key"]
        accept = base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()
        self.send_response_only(101)
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept)
        http.server.BaseHTTPRequestHandler.end_headers(self)
        sock = self.connection
        sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        client = Client(sock)
        try:
            while True:
                opcode, payload = read_frame(sock)
                if opcode == 0x8:
                    break
                if opcode == 0x9:
                    with client.lock:
                        sock.sendall(struct.pack("!BB", 0x8A, len(payload)) + payload)
                    continue
                if opcode == 0x1:
                    try:
                        handle(client, json.loads(payload))
                    except (ValueError, AttributeError):
                        pass
        except (ConnectionError, OSError):
            pass
        finally:
            disconnect(client)
            self.close_connection = True

    def log_message(self, fmt, *args):
        pass  # keep the console quiet; errors still raise


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    try:
        # Routing lookup only (UDP connect sends nothing) to find this machine's LAN address.
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        probe.connect(("10.255.255.255", 1))
        lan_ip = probe.getsockname()[0]
        probe.close()
    except OSError:
        lan_ip = "your-ip"
    print("Velocity Rush running at http://localhost:%d" % port)
    print("Friends on your network: http://%s:%d" % (lan_ip, port))
    http.server.ThreadingHTTPServer(("", port), Handler).serve_forever()
