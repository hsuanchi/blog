// Render the editable SVG cover masters with macOS fonts and local image assets.
import AppKit
import Foundation

func paint(_ value: String, opacity: String? = nil) -> NSColor {
    if value == "none" { return .clear }
    let hex = value.replacingOccurrences(of: "#", with: "")
    let full = hex.count == 3 ? hex.map { "\($0)\($0)" }.joined() : hex
    let number = UInt64(full, radix: 16) ?? 0
    return NSColor(srgbRed: CGFloat((number >> 16) & 255) / 255,
                   green: CGFloat((number >> 8) & 255) / 255,
                   blue: CGFloat(number & 255) / 255,
                   alpha: CGFloat(Double(opacity ?? "1") ?? 1))
}

final class CoverRenderer: NSObject, XMLParserDelegate {
    let height: CGFloat
    let source: URL
    var attributes: [String: String]?
    var buffer = ""
    init(height: CGFloat, source: URL) { self.height = height; self.source = source }

    func parser(_ parser: XMLParser, didStartElement element: String, namespaceURI: String?, qualifiedName: String?, attributes a: [String: String]) {
        func number(_ key: String, _ fallback: Double = 0) -> CGFloat {
            CGFloat(Double(a[key] ?? "") ?? fallback)
        }
        let rect = NSRect(x: number("x"), y: height - number("y") - number("height"), width: number("width"), height: number("height"))
        if element == "image", let reference = a["href"] {
            let url = URL(fileURLWithPath: reference, relativeTo: source.deletingLastPathComponent()).standardizedFileURL
            guard let image = NSImage(contentsOf: url) else { fatalError("Cannot read background: \(url.path)") }
            NSGraphicsContext.saveGraphicsState()
            NSBezierPath(rect: rect).addClip()
            let scale = max(rect.width / image.size.width, rect.height / image.size.height)
            let size = NSSize(width: image.size.width * scale, height: image.size.height * scale)
            let frame = NSRect(x: rect.midX - size.width / 2, y: rect.midY - size.height / 2, width: size.width, height: size.height)
            image.draw(in: frame, from: .zero, operation: .sourceOver, fraction: 1)
            NSGraphicsContext.restoreGraphicsState()
        } else if element == "rect" {
            let shape = NSBezierPath(roundedRect: rect, xRadius: number("rx"), yRadius: number("rx"))
            paint(a["fill"] ?? "#000000", opacity: a["opacity"]).setFill()
            shape.fill()
            if let stroke = a["stroke"] { paint(stroke).setStroke(); shape.lineWidth = number("stroke-width", 1); shape.stroke() }
        } else if element == "circle" {
            let radius = number("r")
            paint(a["fill"] ?? "#000000").setFill()
            NSBezierPath(ovalIn: NSRect(x: number("cx") - radius, y: height - number("cy") - radius, width: radius * 2, height: radius * 2)).fill()
        } else if element == "text" { attributes = a; buffer = "" }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        if attributes != nil { buffer += string }
    }

    func parser(_ parser: XMLParser, didEndElement element: String, namespaceURI: String?, qualifiedName: String?) {
        guard element == "text", let a = attributes else { return }
        let size = CGFloat(Double(a["font-size"] ?? "24") ?? 24)
        let weight = Int(a["font-weight"] ?? "400") ?? 400
        let name = weight >= 600 ? "PingFangTC-Semibold" : (weight >= 500 ? "PingFangTC-Medium" : "PingFangTC-Regular")
        let font = NSFont(name: name, size: size) ?? NSFont.systemFont(ofSize: size)
        let string = NSAttributedString(string: buffer, attributes: [.font: font, .foregroundColor: paint(a["fill"] ?? "#ffffff")])
        let width = string.size().width
        var x = CGFloat(Double(a["x"] ?? "0") ?? 0)
        if a["text-anchor"] == "middle" { x -= width / 2 }
        if a["text-anchor"] == "end" { x -= width }
        let y = height - CGFloat(Double(a["y"] ?? "0") ?? 0) + font.descender
        string.draw(at: NSPoint(x: x, y: y))
        attributes = nil
    }
}

guard CommandLine.arguments.count == 3 else { fatalError("Usage: render-brand-cover input.svg output.jpg|png") }
let source = URL(fileURLWithPath: CommandLine.arguments[1])
let target = URL(fileURLWithPath: CommandLine.arguments[2])
let width = 1200, height = 675
let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
bitmap.size = NSSize(width: width, height: height)
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
NSColor.white.setFill()
NSRect(x: 0, y: 0, width: width, height: height).fill()
let renderer = CoverRenderer(height: CGFloat(height), source: source)
let parser = XMLParser(data: try Data(contentsOf: source))
parser.delegate = renderer
guard parser.parse() else { fatalError("Invalid SVG: \(String(describing: parser.parserError))") }
NSGraphicsContext.restoreGraphicsState()
let type: NSBitmapImageRep.FileType = target.pathExtension.lowercased() == "png" ? .png : .jpeg
let data = bitmap.representation(using: type, properties: [.compressionFactor: 0.94])!
try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
try data.write(to: target)
print("Rendered \(target.lastPathComponent) (1200 × 675)")
