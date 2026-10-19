import UIKit
import AuthenticationServices

// Place this class in the Credential Provider Extension target (iOS 18+).
final class CredentialProviderViewController: ASCredentialProviderViewController {
    private let statusLabel = UILabel()
    private let codeButton = UIButton(type: .system)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        statusLabel.text = "Checking for the latest verification code…"
        statusLabel.numberOfLines = 0
        statusLabel.textAlignment = .center

        codeButton.setTitle("Use code", for: .normal)
        codeButton.titleLabel?.font = .preferredFont(forTextStyle: .title2)
        codeButton.isEnabled = false
        codeButton.addTarget(self, action: #selector(fillCode), for: .touchUpInside)
        let retryButton = UIButton(type: .system)
        retryButton.setTitle("Refresh", for: .normal)
        retryButton.addTarget(self, action: #selector(loadCode), for: .touchUpInside)
        let cancelButton = UIButton(type: .system)
        cancelButton.setTitle("Cancel", for: .normal)
        cancelButton.addTarget(self, action: #selector(cancel), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [statusLabel, codeButton, retryButton, cancelButton])
        stack.axis = .vertical
        stack.spacing = 20
        stack.alignment = .fill
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -20),
            stack.centerYAnchor.constraint(equalTo: view.centerYAnchor)
        ])
    }

    override func prepareOneTimeCodeCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        loadViewIfNeeded()
        loadCode()
    }

    override func prepareInterfaceToProvideCredential(for credentialRequest: ASCredentialRequest) {
        loadViewIfNeeded()
        loadCode()
    }

    override func provideCredentialWithoutUserInteraction(for credentialRequest: ASCredentialRequest) {
        // Avoid silently filling a code into the wrong service. Show the chooser instead.
        let error = NSError(domain: ASExtensionErrorDomain,
                            code: ASExtensionError.Code.userInteractionRequired.rawValue)
        extensionContext.cancelRequest(withError: error)
    }

    private var selectedCode: RelayOTP?

    @objc private func loadCode() {
        selectedCode = nil
        codeButton.isEnabled = false
        statusLabel.text = "Fetching code over Wi-Fi…"
        RelayClient.fetch { [weak self] result in
            DispatchQueue.main.async {
                guard let self = self else { return }
                switch result {
                case .success(let code):
                    self.selectedCode = code
                    self.statusLabel.text = code == nil ? "No active OTP. Try Refresh after your Android receives one." : "Latest OTP is ready."
                    self.codeButton.setTitle(code.map { "Fill \($0.code)" } ?? "Use code", for: .normal)
                    self.codeButton.isEnabled = code != nil
                case .failure(let error):
                    self.statusLabel.text = "Unable to fetch OTP: \(error.localizedDescription)"
                }
            }
        }
    }

    @objc private func fillCode() {
        guard let selectedCode else { return }
        guard selectedCode.expiresAt > Date() else { loadCode(); return }
        codeButton.isEnabled = false
        extensionContext.completeOneTimeCodeRequest(using: ASOneTimeCodeCredential(code: selectedCode.code)) { expired in
            if !expired { RelayClient.consume(selectedCode) }
        }
    }

    @objc private func cancel() {
        let error = NSError(domain: ASExtensionErrorDomain,
                            code: ASExtensionError.Code.userCanceled.rawValue)
        extensionContext.cancelRequest(withError: error)
    }
}
