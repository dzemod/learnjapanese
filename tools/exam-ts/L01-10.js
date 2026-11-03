// Review of «Переклад речень», lessons 1–10 (tools/build-exam-ts.mjs). Keys = plain Japanese without spaces.
// skip: not a fair typing task (English inside, names/titles that cannot be guessed from the Ukrainian, too long, duplicate).
module.exports = {
  skip: [
    "これは「9」ですか、「7」ですか。「9」です。", // ts2-20
    "今何時ですか。2時10分です。ニューヨークは今何時ですか。午前0時10分です。", // ts4-4
    "「ありがとう」は英語で何ですか。「Thankyou」です。", // ts7-6
    "「Thankyou」は日本語で何ですか。「ありがとう」です。", // ts7-7
    "“Goodbye”は日本語で何ですか。「さようなら」です。", // ts7-8
    "きのうおもしろい映画を見ました。何を見ましたか。「七人の侍」です。", // ts8-24
    "すみません。ユニューヤ・ストアはどこですか。ユニューヤ・ストアですか。あのビルの中です。", // ts10-31
  ],
  alt: {},
  uk: {},
};
