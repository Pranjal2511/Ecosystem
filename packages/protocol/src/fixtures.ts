export const PATH_FIXTURES = {
  accept: ["photo.jpg", "album/vacation/pic.png"],
  reject: [
    "../secret.txt",
    "ok/../../etc/passwd",
    "C:/Windows/notepad.exe",
    "/etc/passwd",
    "CON",
    "aux.txt",
    "hi<there>.txt"
  ]
};

export const CONTROL_FIXTURE_TRANSFER_OFFER = {
  v: 1,
  requestId: "11111111-1111-4111-8111-111111111111",
  sentAt: 1_700_000_000_000,
  message: {
    type: "transfer_offer",
    transferId: "22222222-2222-4222-8222-222222222222",
    files: [{ index: 0, relativePath: "notes.txt", sizeBytes: 4 }],
    totalBytes: 4
  }
};
