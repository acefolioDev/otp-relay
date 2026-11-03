package com.example.otprelay

import android.graphics.Bitmap
import android.graphics.Color
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
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
     * Generates a real scannable QR code bitmap using ZXing.
     */
    fun createQRCodeBitmap(content: String, size: Int = 512): Bitmap {
        val hints = mapOf(
            EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M,
            EncodeHintType.MARGIN to 2
        )
        val writer = QRCodeWriter()
        val matrix = writer.encode(content, BarcodeFormat.QR_CODE, size, size, hints)
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        for (x in 0 until size) {
            for (y in 0 until size) {
                bitmap.setPixel(x, y, if (matrix[x, y]) Color.BLACK else Color.WHITE)
            }
        }
        return bitmap
    }
}
