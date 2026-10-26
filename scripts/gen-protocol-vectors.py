"""Generate protocol test vectors with the salus-it600-client reference library.

Run with a throwaway venv that has salus-it600-client==0.7.0 installed:
    python -I scripts/gen-protocol-vectors.py

Offline only: uses dummy EUIDs, never touches the network or a gateway.
"""
import json
import os

from cryptography.hazmat.primitives.ciphers.aead import AESCCM
from salus_it600.protocol_aes_cbc import AesCbcProtocol
from salus_it600.protocol_aes_ccm import _derive_key

PLAINTEXT = '{"requestAttr":"readall"}'
NONCE = bytes.fromhex("a1b2c30001765432")
# Observed live: the gateway answers an undecryptable request with this JSON,
# encrypted under the request's key (AES-256-CBC, 32 bytes on the wire).
REJECT_PLAINTEXT = '{"status":"fail"}'
EUIDS = {"euid16": "0123456789ABCDEF", "euid12": "0123456789AB"}


def derive_ccm_key(euid: str) -> bytes:
    """Reference key derivation, except that 09 02 is inserted for 6-byte EUIDs.

    The reference `_derive_key` tests `len(euid_bytes) == 12`, which never yields
    a valid 32-byte key (30 bytes for a 12-hex-char EUID). The 12-char vector
    therefore follows the intended 6-byte rule from the task brief instead; the
    16-char vector is identical to the reference output.
    """
    if len(bytes.fromhex(euid)) == 8:
        return _derive_key(euid)
    raw = bytearray(bytes.fromhex(euid))
    raw[3:3] = b"\x09\x02"
    return bytes(raw) + b"9a4ba190ac2b5139b32c3528"


def main() -> None:
    out = {"plaintext": PLAINTEXT, "euids": {}}
    for label, euid in EUIDS.items():
        cbc256 = AesCbcProtocol(euid)
        cbc128 = AesCbcProtocol(euid, aes128=True)
        key = derive_ccm_key(euid)
        ct_and_tag = AESCCM(key, tag_length=8).encrypt(NONCE, PLAINTEXT.encode(), None)
        out["euids"][label] = {
            "euid": euid,
            "cbc256Hex": cbc256.encrypt(PLAINTEXT).hex(),
            "cbc128Hex": cbc128.encrypt(PLAINTEXT).hex(),
            "ccmNonceHex": NONCE.hex(),
            "ccmWireHex": (ct_and_tag + NONCE).hex(),
        }
    cbc = AesCbcProtocol(EUIDS["euid16"])
    out["cbcTrailerCase"] = {
        "note": "Synthesised: no live response was non-block-aligned. Valid CBC ciphertext plus 5 junk trailing bytes.",
        "euid": EUIDS["euid16"],
        "plaintext": PLAINTEXT,
        "wireHex": (cbc.encrypt(PLAINTEXT) + bytes.fromhex("0102030405")).hex(),
    }
    out["rejectFrameCase"] = {
        "note": "Live reject frame (wrong key) decrypted under the real EUID; plaintext re-encrypted under the dummy EUID.",
        "euid": EUIDS["euid16"],
        "plaintext": REJECT_PLAINTEXT,
        "wireHex": cbc.encrypt(REJECT_PLAINTEXT).hex(),
    }
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "test", "fixtures", "protocol-vectors.json")
    with open(path, "w") as fh:
        json.dump(out, fh, indent=2)
        fh.write("\n")


if __name__ == "__main__":
    main()
