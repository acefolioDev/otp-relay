package com.example.otprelay

import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** Pure JVM AES-GCM helper, shared by the upload path and interoperability tests. */
object RelayCipher {
    fun aad(pairId: String, messageId: String, receivedAt: String, keyId: String): String {
        require(pairId.matches(Regex("[a-f0-9-]{36}")) && messageId.matches(Regex("[a-f0-9-]{36}")))
        require(receivedAt.matches(Regex("[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z")))
        require(keyId.matches(Regex("[A-Za-z0-9_-]{1,64}")))
        return "[\"otp-relay/v1\",\"$pairId\",\"$messageId\",\"android\",\"$receivedAt\",\"$keyId\"]"
    }
    fun encrypt(code: String, key: ByteArray, nonce: ByteArray, aad: String): ByteArray {
        require(code.matches(Regex("[A-Za-z0-9]{4,32}")) && key.size == 32 && nonce.size == 12)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
        cipher.updateAAD(aad.toByteArray(Charsets.UTF_8))
        return cipher.doFinal(code.toByteArray(Charsets.UTF_8)) // ciphertext followed by 16-byte tag
    }
}
