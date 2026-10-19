package com.example.otprelay
import java.util.Base64
fun testRelayCipher() {
    // Public Node-generated vector; these fixed values are ONLY for tests.
    val sealed = RelayCipher.encrypt("Ab7Cd9Ef2G", ByteArray(32) { 1 }, ByteArray(12) { 2 },
        RelayCipher.aad("11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "2026-10-19T12:00:00.000Z", "public-test-vector"))
    check(Base64.getUrlEncoder().withoutPadding().encodeToString(sealed) == "RrT-Ci5uhJvhi2Iqu2AVloVOPnnpSNf5XEM") { "Cross-language encryption vector failed" }
    println("Passed Android encryption interoperability vector (no OTP values logged).")
}
