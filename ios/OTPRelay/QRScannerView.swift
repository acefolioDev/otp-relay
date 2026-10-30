import SwiftUI
import AVFoundation

struct QRScannerView: UIViewControllerRepresentable {
    var onCodeFound: (String) -> Void
    var onCancel: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onCodeFound: onCodeFound)
    }

    func makeUIViewController(context: Context) -> ScannerViewController {
        let controller = ScannerViewController()
        controller.delegate = context.coordinator
        controller.onCancel = onCancel
        return controller
    }

    func updateUIViewController(_ uiViewController: ScannerViewController, context: Context) {}

    class Coordinator: NSObject, AVCaptureMetadataOutputObjectsDelegate {
        let onCodeFound: (String) -> Void
        private var scanned = false

        init(onCodeFound: @escaping (String) -> Void) {
            self.onCodeFound = onCodeFound
        }

        func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
            guard !scanned, let object = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
                  let code = object.stringValue else { return }
            scanned = true
            let generator = UINotificationFeedbackGenerator()
            generator.notificationOccurred(.success)
            DispatchQueue.main.async {
                self.onCodeFound(code)
            }
        }
    }
}

final class ScannerViewController: UIViewController {
    var delegate: AVCaptureMetadataOutputObjectsDelegate?
    var onCancel: (() -> Void)?
    private var captureSession: AVCaptureSession?
    private var previewLayer: AVCaptureVideoPreviewLayer?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black

        let session = AVCaptureSession()
        captureSession = session

        guard let videoCaptureDevice = AVCaptureDevice.default(for: .video),
              let videoInput = try? AVCaptureDeviceInput(device: videoCaptureDevice),
              session.canAddInput(videoInput) else {
            showCameraUnavailable()
            return
        }
        session.addInput(videoInput)

        let metadataOutput = AVCaptureMetadataOutput()
        if session.canAddOutput(metadataOutput) {
            session.addOutput(metadataOutput)
            metadataOutput.setMetadataObjectsDelegate(delegate, queue: DispatchQueue.main)
            metadataOutput.metadataObjectTypes = [.qr]
        } else {
            showCameraUnavailable()
            return
        }

        let preview = AVCaptureVideoPreviewLayer(session: session)
        preview.frame = view.layer.bounds
        preview.videoGravity = .resizeAspectFill
        view.layer.addSublayer(preview)
        previewLayer = preview

        // Cancel button
        let cancelButton = UIButton(type: .system)
        cancelButton.setTitle("Cancel", for: .normal)
        cancelButton.setTitleColor(.white, for: .normal)
        cancelButton.backgroundColor = UIColor.black.withAlphaComponent(0.6)
        cancelButton.layer.cornerRadius = 20
        cancelButton.clipsToBounds = true
        cancelButton.translatesAutoresizingMaskIntoConstraints = false
        cancelButton.addTarget(self, action: #selector(didTapCancel), for: .touchUpInside)
        view.addSubview(cancelButton)

        NSLayoutConstraint.activate([
            cancelButton.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 16),
            cancelButton.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            cancelButton.widthAnchor.constraint(equalToConstant: 80),
            cancelButton.heightAnchor.constraint(equalToConstant: 40)
        ])

        DispatchQueue.global(qos: .userInitiated).async {
            session.startRunning()
        }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.layer.bounds
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        if captureSession?.isRunning == true {
            captureSession?.stopRunning()
        }
    }

    @objc private func didTapCancel() {
        onCancel?()
    }

    private func showCameraUnavailable() {
        let label = UILabel()
        label.text = "Camera is not available on this device or permission was denied."
        label.textColor = .white
        label.textAlignment = .center
        label.numberOfLines = 0
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            label.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
            label.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -32)
        ])
    }
}
