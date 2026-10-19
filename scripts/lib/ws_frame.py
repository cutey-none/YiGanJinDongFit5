"""取 Lite Wearable 引擎 WebSocket 首帧（JPEG），只用 Python 标准库。

用法：python3 ws_frame.py <port> <out.jpg>
引擎发送的报文格式：24/40 字节的头部 + 一段 JPEG（FFD8...FFD9）。
"""
import base64
import os
import socket
import struct
import sys

SID = "abcdef0123456789abcdef0123456789"


def handshake(sock, port):
    key = base64.b64encode(os.urandom(16)).decode()
    request = (
        "GET /%s HTTP/1.1\r\n"
        "Host: 127.0.0.1:%d\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        "Sec-WebSocket-Key: %s\r\n"
        "Sec-WebSocket-Version: 13\r\n\r\n"
    ) % (SID, port, key)
    sock.sendall(request.encode())
    data = b""
    while b"\r\n\r\n" not in data:
        chunk = sock.recv(4096)
        if not chunk:
            raise RuntimeError("handshake closed")
        data += chunk
    if b"101" not in data.split(b"\r\n")[0]:
        raise RuntimeError("handshake failed: %s" % data.split(b"\r\n")[0])
    return data.split(b"\r\n\r\n", 1)[1]


def read_exact(sock, buf, count):
    while len(buf) < count:
        chunk = sock.recv(65536)
        if not chunk:
            raise RuntimeError("socket closed")
        buf += chunk
    return buf[:count], buf[count:]


def read_frame(sock, buf):
    head, buf = read_exact(sock, buf, 2)
    fin = head[0] & 0x80
    opcode = head[0] & 0x0F
    masked = head[1] & 0x80
    length = head[1] & 0x7F
    if length == 126:
        raw, buf = read_exact(sock, buf, 2)
        length = struct.unpack(">H", raw)[0]
    elif length == 127:
        raw, buf = read_exact(sock, buf, 8)
        length = struct.unpack(">Q", raw)[0]
    mask = b""
    if masked:
        mask, buf = read_exact(sock, buf, 4)
    payload, buf = read_exact(sock, buf, length)
    if masked:
        payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    return fin, opcode, payload, buf


def main():
    port = int(sys.argv[1])
    out_path = sys.argv[2]
    sock = socket.create_connection(("127.0.0.1", port), timeout=8)
    sock.settimeout(8)
    buf = handshake(sock, port)
    payload = b""
    while True:
        fin, opcode, data, buf = read_frame(sock, buf)
        if opcode == 0x8:
            raise RuntimeError("engine closed the connection")
        if opcode in (0x1, 0x2):
            payload += data
            if fin:
                break
    sock.close()
    start = payload.find(b"\xff\xd8\xff")
    end = payload.rfind(b"\xff\xd9")
    if start < 0 or end < 0:
        raise RuntimeError("no JPEG in frame (%d bytes)" % len(payload))
    with open(out_path, "wb") as handle:
        handle.write(payload[start:end + 2])


if __name__ == "__main__":
    main()
