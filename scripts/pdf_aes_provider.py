"""Read public AES protected PDFs without native extensions in GenVM.

The block cipher is pyaes 1.6.1. This adapter supplies pypdf's existing provider
interface, including its strict PKCS7 check. It never handles user credentials.
"""
from pyaes import AESModeOfOperationCBC, AESModeOfOperationECB
from pypdf.errors import PdfStreamError


def _blocks(mode, data, action):
    if len(data) % 16:
        raise PdfStreamError('AES ciphertext must contain complete blocks')
    operation = getattr(mode, action)
    return b''.join(operation(data[i:i+16]) for i in range(0, len(data), 16))


def aes_ecb_decrypt(key, data):
    return _blocks(AESModeOfOperationECB(key), data, 'decrypt')


def aes_ecb_encrypt(key, data):
    return _blocks(AESModeOfOperationECB(key), data, 'encrypt')


def aes_cbc_decrypt(key, iv, data):
    return _blocks(AESModeOfOperationCBC(key, iv=iv), data, 'decrypt')


def aes_cbc_encrypt(key, iv, data):
    return _blocks(AESModeOfOperationCBC(key, iv=iv), data, 'encrypt')


class CryptAES:
    def __init__(self, key):
        self.key = key

    def decrypt(self, data, *, strict=True):
        if len(data) < 16:
            raise PdfStreamError('Missing AES initialization vector')
        if len(data) == 16:
            return b''
        decoded = aes_cbc_decrypt(self.key, data[:16], data[16:])
        padding = decoded[-1]
        valid = 1 <= padding <= 16 and decoded[-padding:] == bytes([padding])*padding
        if strict and not valid:
            raise PdfStreamError('Invalid AES PDF padding')
        return decoded[:-padding] if padding else decoded

    def encrypt(self, data):
        raise PdfStreamError('The Meter PDF provider is for reading evidence only')
