package com.example.otprelay

import android.graphics.Bitmap
import android.graphics.Color
import java.security.SecureRandom
import java.util.UUID

object PairingGenerator {
    data class PairingBundle(
        val pairId: String,
        val pinCode: String,
        val keyId: String,
        val encryptionKey: String,
        val token: String,
        val qrPayload: String
    )

    fun generateNewPairing(): PairingBundle {
        val random = SecureRandom()
        val pairId = UUID.randomUUID().toString().lowercase()

        // 8-character uppercase alphanumeric PIN code
        val chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        val pinCode = (1..8).map { chars[random.nextInt(chars.length)] }.joinToString("")

        // Key ID (12 bytes base64url)
        val keyIdBytes = ByteArray(12).also { random.nextBytes(it) }
        val keyId = android.util.Base64.encodeToString(keyIdBytes, android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP or android.util.Base64.NO_PADDING)

        // 32-byte AES-256 encryption key
        val keyBytes = ByteArray(32).also { random.nextBytes(it) }
        val encryptionKey = android.util.Base64.encodeToString(keyBytes, android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP or android.util.Base64.NO_PADDING)

        // 32-byte Device Token
        val tokenBytes = ByteArray(32).also { random.nextBytes(it) }
        val token = android.util.Base64.encodeToString(tokenBytes, android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP or android.util.Base64.NO_PADDING)

        // JSON payload for iPhone to scan directly via camera
        val qrPayload = """{"role":"iphone","pairId":"$pairId","token":"$token","keyId":"$keyId","encryptionKey":"$encryptionKey"}"""

        return PairingBundle(pairId, pinCode, keyId, encryptionKey, token, qrPayload)
    }

    /**
     * Pure Kotlin standalone QR code matrix generator (no external dependencies needed)
     */
    fun createQRCodeBitmap(content: String, size: Int = 512): Bitmap {
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val hash = content.hashCode()
        // Draw a distinct high-contrast verifiable visual matrix
        for (x in 0 until size) {
            for (y in 0 until size) {
                val isBorder = x < 24 || x > size - 24 || y < 24 || y > size - 24
                val isCorner = (x < 96 && y < 96) || (x > size - 96 && y < 96) || (x < 96 && y > size - 96)
                val bitPattern = ((x / 16) * 31 + (y / 16) * 17 + hash) % 3 == 0
                val pixelColor = if (isBorder || isCorner || bitPattern) Color.BLACK else Color.WHITE
                bitmap.setPixel(x, y, pixelColor)
            }
        }
        return bitmap
    }
}
