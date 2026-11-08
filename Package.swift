// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "MemoCore",
    platforms: [.iOS(.v17)],
    products: [.library(name: "MemoCore", targets: ["MemoCore"])],
    targets: [
        .target(name: "MemoCore", resources: [.process("Resources")]),
        .testTarget(name: "MemoCoreTests", dependencies: ["MemoCore"], resources: [.copy("Fixtures")])
    ]
)
