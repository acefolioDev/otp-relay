package com.example.otprelay

import android.content.Context
import android.util.Base64
import android.util.Log
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

object Upload {
    // Bounded work; no unbounded thread creation. Persisted retries need an encrypted WorkManager job.
    private val executor = ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS, ArrayBlockingQueue<Runnable>(8),
        Executors.defaultThreadFactory(), ThreadPoolExecutor.AbortPolicy())
    private val timestamp = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)
    private fun b64(data: ByteArray) = Base64.encodeToString(data, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)

    fun uploadAsync(context: Context, code: String, completion: () -> Unit = {}) {
        if (!code.matches(Regex("[A-Za-z0-9]{4,32}"))) { completion(); return }
        val host = context.getSharedPreferences("relay", Context.MODE_PRIVATE).getString("url", "") ?: ""
        val pairing = RelayPairing.read(context) ?: run { completion(); return }
        if (!host.startsWith("https://")) { completion(); return }
        // Assign once before queueing. Retries must reuse the exact ID, nonce, time and ciphertext.
        val receivedAt = timestamp.format(Instant.now())
        val messageId = UUID.randomUUID().toString()
        try { executor.execute {
            try {
                val nonce = ByteArray(12).also { SecureRandom().nextBytes(it) }
                val aad = RelayCipher.aad(pairing.pairId, messageId, receivedAt, pairing.keyId)
                // Preserve the exact UTF-8 string; do not lowercase, uppercase or parse as a number.
                val sealed = RelayCipher.encrypt(code, pairing.encryptionKey, nonce, aad)
                val payload = JSONObject().put("messageId", messageId).put("source", "android").put("receivedAt", receivedAt)
                    .put("encrypted", JSONObject().put("algorithm", "A256GCM").put("keyId", pairing.keyId)
                        .put("nonce", b64(nonce)).put("ciphertext", b64(sealed.copyOfRange(0, sealed.size - 16)))
                        .put("tag", b64(sealed.copyOfRange(sealed.size - 16, sealed.size))))
                val connection = URL("${host.trimEnd('/')}/api/v1/otp").openConnection() as HttpURLConnection
                try {
                    connection.requestMethod = "POST"
                    connection.instanceFollowRedirects = false
                    connection.connectTimeout = 4000
                    connection.readTimeout = 4000
                    connection.setRequestProperty("Authorization", "Bearer ${pairing.token}")
                    connection.setRequestProperty("Content-Type", "application/json")
                    connection.doOutput = true
                    connection.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
                    if (connection.responseCode !in 200..299) Log.w("OTPRelay", "Relay rejected request with HTTP ${connection.responseCode}")
                } finally { connection.disconnect() }
            } catch (_: Exception) {
                Log.w("OTPRelay", "Relay upload failed") // No payload, credentials, exception text or OTP.
            } finally { completion() }
        } } catch (_: java.util.concurrent.RejectedExecutionException) { completion() }
    }
}
