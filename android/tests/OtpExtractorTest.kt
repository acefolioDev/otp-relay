package com.example.otprelay

/** Pure JVM tests; no phone, Android runtime or real OTPs required. */
fun main() {
    var count = 0
    fun test(message: String, expected: String?) {
        check(OtpExtractor.extract(message) == expected) { "Synthetic extractor test failed at case $count" }
        count++
    }
    test("Your easypaisa mobile account registration/login OTP is Ab7Cd9Ef2G OTP aur PIN ko mahfooz rakhein", "Ab7Cd9Ef2G")
    test("Your easypaisa mobile account registration/login OTP is aB7cD9eF2g OTP aur PIN ko mahfooz rakhein", "aB7cD9eF2g")
    test("OTP is 001234 OTP aur PIN ko mahfooz rakhein", "001234")
    test("OTP is 1234567890", "1234567890")
    test("Your OTP IS Ab7Cd9Ef2G.", "Ab7Cd9Ef2G")
    test("<#> OTP is Ab7Cd9Ef2G\nFA+9qCX9VSu", "Ab7Cd9Ef2G")
    test("<#> Your verification code: 123456\nFA+9qCX9VSu", "123456")
    test("Verification code: 001234\nAb7Cd9Ef2Gh", "001234")
    test("Login OTP\nAb7Cd9Ef2Gh", null)
    test("OTP is Ab7Cd9Ef2Gh", null)
    test("OTP is FA+9qCX9VSu", null)
    test("OTP is Ab7Cd9Ef2G/other", null)
    test("OTP is Ab7Cd9Ef2G_extra", null)
    test("OTP is abc1234567890", null)
    test("OTP is 123", null)
    test("OTP is secret", null)
    test("OTP is Ab7Cd9Ef2G and OTP is 123456", null)
    test("OTP is Ab7Cd9Ef2Gh, fallback number 123456", null)
    test("Balance 123456", null)
    test("Your login code is 123456. Ref 987654", null)
    test("OTP\nFA+9qCX9VSu", null)
    test("OTP FA12345678x", null)
    test("OTP abc123456xyz", null)
    test("Your verification code is 123456", "123456")
    val sample = "OTP is Ab7Cd9Ef2G"
    check(OtpExtractor.extractApproved("EASYPAISA", listOf(" easypaisa "), sample) == "Ab7Cd9Ef2G"); count++
    check(OtpExtractor.extractApproved("UNAPPROVED", listOf("EASYPAISA"), sample) == null); count++
    check(OtpExtractor.extractApproved("EASYPAISA", emptyList(), sample) == null); count++
    check(OtpExtractor.extractApproved(null, listOf("EASYPAISA"), sample) == null); count++
    check(OtpExtractor.extractApproved("EASYPAISA", listOf("EASY"), sample) == null); count++
    println("Passed $count synthetic extractor tests (no OTP values logged).")
    testRelayCipher()
}
