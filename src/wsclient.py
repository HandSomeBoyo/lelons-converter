"""A small WebSocket client (the way OBS talks to other programs), with nothing extra to install.

Only what the app needs: connect, send text, read text. Pings are answered by itself.
"""

import base64
import json
import os
import socket
import ssl
import struct
import urllib.parse


class Closed(Exception):
    pass


class WebSocket:
    def __init__(self, url, timeout=10):
        parts = urllib.parse.urlsplit(url)
        secure = parts.scheme == "wss"
        host, port = parts.hostname, parts.port or (443 if secure else 80)
        raw = socket.create_connection((host, port), timeout=timeout)
        self.sock = ssl.create_default_context().wrap_socket(raw, server_hostname=host) if secure else raw
        self.sock.settimeout(timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        path = (parts.path or "/") + ("?" + parts.query if parts.query else "")
        self.sock.sendall((f"GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                           f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = self.sock.recv(1024)
            if not chunk:
                raise Closed("no answer")
            head += chunk
            if len(head) > 16384:
                raise Closed("bad answer")
        head, _, self.buffer = head.partition(b"\r\n\r\n")
        if b" 101" not in head.split(b"\r\n", 1)[0]:
            raise Closed("refused")

    def _read(self, n):
        while len(self.buffer) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise Closed("closed")
            self.buffer += chunk
        out, self.buffer = self.buffer[:n], self.buffer[n:]
        return out

    def _send(self, opcode, payload):
        head = bytes([0x80 | opcode])
        n = len(payload)
        if n < 126:
            head += bytes([0x80 | n])
        elif n < 65536:
            head += bytes([0x80 | 126]) + struct.pack("!H", n)
        else:
            head += bytes([0x80 | 127]) + struct.pack("!Q", n)
        mask = os.urandom(4)
        self.sock.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))

    def send(self, text):
        self._send(0x1, text.encode() if isinstance(text, str) else text)

    def send_json(self, value):
        self.send(json.dumps(value))

    def recv(self):
        """The next text message (waits for it; socket.timeout if none comes in time)."""
        parts = b""
        while True:
            a, b = self._read(2)
            opcode, n = a & 0x0F, b & 0x7F
            if n == 126:
                n = struct.unpack("!H", self._read(2))[0]
            elif n == 127:
                n = struct.unpack("!Q", self._read(8))[0]
            mask = self._read(4) if b & 0x80 else None
            data = self._read(n)
            if mask:
                data = bytes(x ^ mask[i % 4] for i, x in enumerate(data))
            if opcode == 0x8:
                raise Closed("closed")
            if opcode == 0x9:
                self._send(0xA, data)
                continue
            if opcode == 0xA:
                continue
            parts += data
            if a & 0x80:
                return parts.decode("utf-8", "replace")

    def recv_json(self):
        return json.loads(self.recv())

    def close(self):
        try:
            self._send(0x8, b"")
        except OSError:
            pass
        try:
            self.sock.close()
        except OSError:
            pass
