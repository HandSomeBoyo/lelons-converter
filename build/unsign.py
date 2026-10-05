"""Copy a Windows .exe without its digital signature.

The app's exe is Python's pythonw.exe with a new name and icon. Changing the
file would leave a broken signature on it, which looks worse than none.
"""

import struct
import sys

source, target = sys.argv[1:3]
data = bytearray(open(source, "rb").read())
pe = struct.unpack_from("<I", data, 0x3C)[0]
assert data[pe:pe + 4] == b"PE\0\0", "not a Windows program"
optional = pe + 24
magic = struct.unpack_from("<H", data, optional)[0]
directories = optional + (112 if magic == 0x20B else 96)  # 64-bit or 32-bit
entry = directories + 4 * 8  # the 5th: the signature ("security") table
offset, size = struct.unpack_from("<II", data, entry)
if offset and size:
    struct.pack_into("<II", data, entry, 0, 0)
    if offset + size >= len(data) - 8:  # it's at the end of the file, where it always is
        del data[offset:]
open(target, "wb").write(data)
