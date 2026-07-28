import ExpoModulesCore
import AVFoundation
import Photos
import UIKit

// MARK: - 入参

struct ClipInput: Record {
  @Field var id: String = ""
  @Field var sourcePath: String = ""
  @Field var start: Double = 0
  @Field var end: Double = 0
  @Field var title: String = ""
}

struct ExportOptions: Record {
  @Field var albumName: String = "宽宽爸视频切片"
  @Field var clips: [ClipInput] = []
  @Field var burnSubtitle: Bool = true
  @Field var watermark: String = ""
}

struct MergeOptions: Record {
  @Field var albumName: String = "宽宽爸视频切片"
  @Field var name: String = "合并"
  @Field var clips: [ClipInput] = []
  @Field var burnSubtitle: Bool = true
  @Field var watermark: String = ""
}

enum ClipperError: Error, LocalizedError {
  case noVideoTrack(String)
  case badSource(String)
  case exportFailed(String)
  case noPhotoPermission

  var errorDescription: String? {
    switch self {
    case .noVideoTrack(let n): return "「\(n)」里没有找到视频轨"
    case .badSource(let n): return "读不到源文件：\(n)"
    case .exportFailed(let m): return m
    case .noPhotoPermission: return "没有写入相册的权限，请到「设置 → 宽宽爸视频切片 → 照片」里开启"
    }
  }
}

// MARK: - 模块

public class ClipperMediaModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ClipperMedia")

    Events("onProgress")

    OnCreate {
      DispatchQueue.main.async {
        EdgeGestureGuard.install()
      }
    }

    /** 底边系统手势延后生效：拖底部的进度条时不会误切到别的 app */
    Function("setDeferBottomGesture") { (on: Bool) in
      DispatchQueue.main.async {
        EdgeGestureGuard.enabled = on
        EdgeGestureGuard.refresh()
      }
    }

    AsyncFunction("exportClips") { (options: ExportOptions) -> [String: Any] in
      try await self.requirePhotoPermission()
      var outputs: [String] = []
      let total = options.clips.count
      for (i, clip) in options.clips.enumerated() {
        let url = try await self.renderSingle(
          clip: clip,
          burnSubtitle: options.burnSubtitle,
          watermark: options.watermark,
          onProgress: { p in
            self.emitProgress(index: i, total: total, name: clip.title, progress: p)
          }
        )
        try await self.saveToAlbum(url: url, album: options.albumName)
        try? FileManager.default.removeItem(at: url)
        outputs.append(clip.id)
        self.emitProgress(index: i, total: total, name: clip.title, progress: 1)
      }
      return ["ok": true, "count": outputs.count, "ids": outputs]
    }

    AsyncFunction("mergeClips") { (options: MergeOptions) -> [String: Any] in
      try await self.requirePhotoPermission()
      let url = try await self.renderMerged(
        clips: options.clips,
        name: options.name,
        burnSubtitle: options.burnSubtitle,
        watermark: options.watermark,
        onProgress: { p in
          self.emitProgress(index: 0, total: 1, name: options.name, progress: p)
        }
      )
      try await self.saveToAlbum(url: url, album: options.albumName)
      try? FileManager.default.removeItem(at: url)
      return ["ok": true, "name": options.name]
    }
  }

  private func emitProgress(index: Int, total: Int, name: String, progress: Double) {
    sendEvent(
      "onProgress",
      [
        "index": index,
        "total": total,
        "name": name,
        "progress": progress
      ])
  }

  // MARK: - 权限

  private func requirePhotoPermission() async throws {
    // iOS 14 起才有「仅添加」这一档权限；更老的系统只能退回读写全量授权
    if #available(iOS 14, *) {
      let status = PHPhotoLibrary.authorizationStatus(for: .addOnly)
      if status == .authorized || status == .limited { return }
      let granted = await withCheckedContinuation { (c: CheckedContinuation<PHAuthorizationStatus, Never>) in
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { c.resume(returning: $0) }
      }
      guard granted == .authorized || granted == .limited else { throw ClipperError.noPhotoPermission }
    } else {
      let status = PHPhotoLibrary.authorizationStatus()
      if status == .authorized { return }
      let granted = await withCheckedContinuation { (c: CheckedContinuation<PHAuthorizationStatus, Never>) in
        PHPhotoLibrary.requestAuthorization { c.resume(returning: $0) }
      }
      guard granted == .authorized else { throw ClipperError.noPhotoPermission }
    }
  }

  // MARK: - 单个片段

  private func renderSingle(
    clip: ClipInput,
    burnSubtitle: Bool,
    watermark: String,
    onProgress: @escaping (Double) -> Void
  ) async throws -> URL {
    guard let src = URL(string: clip.sourcePath) ?? URL(fileURLWithPath: clip.sourcePath) as URL? else {
      throw ClipperError.badSource(clip.title)
    }
    let asset = AVURLAsset(url: src)
    guard let vTrack = asset.tracks(withMediaType: .video).first else {
      throw ClipperError.noVideoTrack(clip.title)
    }

    let comp = AVMutableComposition()
    let range = CMTimeRange(
      start: CMTime(seconds: clip.start, preferredTimescale: 600),
      end: CMTime(seconds: clip.end, preferredTimescale: 600)
    )

    guard let compV = comp.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)
    else { throw ClipperError.noVideoTrack(clip.title) }
    try compV.insertTimeRange(range, of: vTrack, at: .zero)
    compV.preferredTransform = vTrack.preferredTransform

    if let aTrack = asset.tracks(withMediaType: .audio).first,
      let compA = comp.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
    {
      try? compA.insertTimeRange(range, of: aTrack, at: .zero)
    }

    // 标注为空时无需重编码，直接用直通导出（秒级、画质无损）
    let labels = burnSubtitle ? [(text: clip.title, range: CMTimeRange(start: .zero, duration: comp.duration))] : []
    let needsRender = !watermark.isEmpty || labels.contains { !$0.text.isEmpty }

    let videoComp = needsRender ? buildVideoComposition(for: comp, labels: labels, watermark: watermark) : nil
    return try await export(comp, videoComposition: videoComp, fileName: safeName(clip.title), onProgress: onProgress)
  }

  // MARK: - 合并

  private func renderMerged(
    clips: [ClipInput],
    name: String,
    burnSubtitle: Bool,
    watermark: String,
    onProgress: @escaping (Double) -> Void
  ) async throws -> URL {
    let comp = AVMutableComposition()
    guard let compV = comp.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)
    else { throw ClipperError.noVideoTrack(name) }
    let compA = comp.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)

    var cursor = CMTime.zero
    var labels: [(text: String, range: CMTimeRange)] = []
    var transformSet = false

    for clip in clips {
      guard let src = URL(string: clip.sourcePath) ?? URL(fileURLWithPath: clip.sourcePath) as URL? else { continue }
      let asset = AVURLAsset(url: src)
      guard let vTrack = asset.tracks(withMediaType: .video).first else { continue }
      let range = CMTimeRange(
        start: CMTime(seconds: clip.start, preferredTimescale: 600),
        end: CMTime(seconds: clip.end, preferredTimescale: 600)
      )
      try compV.insertTimeRange(range, of: vTrack, at: cursor)
      if !transformSet {
        // 以第一段的方向为准：混排不同方向的素材本就没有正确答案
        compV.preferredTransform = vTrack.preferredTransform
        transformSet = true
      }
      if let aTrack = asset.tracks(withMediaType: .audio).first {
        try? compA?.insertTimeRange(range, of: aTrack, at: cursor)
      } else {
        // 没有音轨的片段要补静音，否则后面的声音会整体前移
        compA?.insertEmptyTimeRange(CMTimeRange(start: cursor, duration: range.duration))
      }
      if burnSubtitle && !clip.title.isEmpty {
        labels.append((text: clip.title, range: CMTimeRange(start: cursor, duration: range.duration)))
      }
      cursor = CMTimeAdd(cursor, range.duration)
    }

    let needsRender = !watermark.isEmpty || !labels.isEmpty
    let videoComp = needsRender ? buildVideoComposition(for: comp, labels: labels, watermark: watermark) : nil
    return try await export(comp, videoComposition: videoComp, fileName: safeName(name), onProgress: onProgress)
  }

  // MARK: - 字幕 / 水印图层

  private func buildVideoComposition(
    for comp: AVMutableComposition,
    labels: [(text: String, range: CMTimeRange)],
    watermark: String
  ) -> AVMutableVideoComposition {
    // propertiesOf 会按各轨道的 preferredTransform 生成正确的 renderSize 与指令，
    // 比手工拼 layerInstruction 稳得多（竖拍素材尤其容易算错）
    let videoComp = AVMutableVideoComposition(propertiesOf: comp)
    let size = videoComp.renderSize

    let parent = CALayer()
    parent.frame = CGRect(origin: .zero, size: size)
    parent.isGeometryFlipped = false

    let videoLayer = CALayer()
    videoLayer.frame = parent.frame
    parent.addSublayer(videoLayer)

    let fontSize = max(18, size.height / 22)

    for label in labels where !label.text.isEmpty {
      let text = makeTextLayer(label.text, fontSize: fontSize, width: size.width)
      // CoreAnimation 里 y 轴朝上，字幕压在画面底部 → y 取小值
      text.frame = CGRect(x: size.width * 0.05, y: size.height * 0.06, width: size.width * 0.9, height: fontSize * 2.6)

      if labels.count > 1 {
        // 合并时按各自的时间段显隐
        text.opacity = 0
        let show = CAKeyframeAnimation(keyPath: "opacity")
        show.values = [0, 1, 1, 0]
        show.keyTimes = [0, 0.001, 0.999, 1]
        show.beginTime = AVCoreAnimationBeginTimeAtZero + CMTimeGetSeconds(label.range.start)
        show.duration = CMTimeGetSeconds(label.range.duration)
        show.isRemovedOnCompletion = false
        show.fillMode = .backwards
        text.add(show, forKey: "show")
      }
      parent.addSublayer(text)
    }

    if !watermark.isEmpty {
      let markSize = max(14, size.height / 34)
      let mark = makeTextLayer(watermark, fontSize: markSize, width: size.width, align: .right, dim: true)
      mark.frame = CGRect(
        x: size.width * 0.5 - 12, y: size.height - markSize * 2.4,
        width: size.width * 0.5, height: markSize * 1.8)
      parent.addSublayer(mark)
    }

    videoComp.animationTool = AVVideoCompositionCoreAnimationTool(
      postProcessingAsVideoLayer: videoLayer, in: parent)
    return videoComp
  }

  private func makeTextLayer(
    _ text: String, fontSize: CGFloat, width: CGFloat,
    align: CATextLayerAlignmentMode = .center, dim: Bool = false
  ) -> CATextLayer {
    let layer = CATextLayer()
    layer.string = NSAttributedString(
      string: text,
      attributes: [
        .font: UIFont.systemFont(ofSize: fontSize, weight: .semibold),
        .foregroundColor: UIColor.white.withAlphaComponent(dim ? 0.55 : 1).cgColor,
        // 描边让字幕在任何画面上都读得清
        .strokeColor: UIColor.black.withAlphaComponent(dim ? 0.35 : 0.75).cgColor,
        .strokeWidth: -3.0
      ])
    layer.alignmentMode = align
    layer.isWrapped = true
    layer.truncationMode = .end
    // renderSize 已经是像素，不要再乘屏幕缩放
    layer.contentsScale = 1
    return layer
  }

  // MARK: - 导出

  private func export(
    _ comp: AVMutableComposition,
    videoComposition: AVMutableVideoComposition?,
    fileName: String,
    onProgress: @escaping (Double) -> Void
  ) async throws -> URL {
    let preset = videoComposition == nil ? AVAssetExportPresetPassthrough : AVAssetExportPresetHighestQuality
    guard let session = AVAssetExportSession(asset: comp, presetName: preset) else {
      throw ClipperError.exportFailed("创建导出会话失败")
    }
    let out = FileManager.default.temporaryDirectory
      .appendingPathComponent("\(fileName)-\(Int(Date().timeIntervalSince1970 * 1000)).mp4")
    session.outputURL = out
    session.outputFileType = .mp4
    session.shouldOptimizeForNetworkUse = true
    session.videoComposition = videoComposition

    let ticker = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { _ in
      onProgress(Double(session.progress))
    }
    defer { ticker.invalidate() }

    await session.export()

    switch session.status {
    case .completed:
      return out
    case .cancelled:
      throw ClipperError.exportFailed("导出已取消")
    default:
      throw ClipperError.exportFailed(session.error?.localizedDescription ?? "导出失败")
    }
  }

  // MARK: - 写回相册

  private func saveToAlbum(url: URL, album: String) async throws {
    let collection = try await findOrCreateAlbum(named: album)
    try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
      PHPhotoLibrary.shared().performChanges {
        guard let req = PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: url) else { return }
        if let collection,
          let addition = PHAssetCollectionChangeRequest(for: collection),
          let placeholder = req.placeholderForCreatedAsset
        {
          addition.addAssets([placeholder] as NSArray)
        }
      } completionHandler: { ok, err in
        if ok {
          c.resume()
        } else {
          c.resume(throwing: ClipperError.exportFailed(err?.localizedDescription ?? "写入相册失败"))
        }
      }
    }
  }

  private func findOrCreateAlbum(named name: String) async throws -> PHAssetCollection? {
    let opts = PHFetchOptions()
    opts.predicate = NSPredicate(format: "title = %@", name)
    let found = PHAssetCollection.fetchAssetCollections(with: .album, subtype: .albumRegular, options: opts)
    if let existing = found.firstObject { return existing }

    var id: String?
    try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
      PHPhotoLibrary.shared().performChanges {
        let req = PHAssetCollectionChangeRequest.creationRequestForAssetCollection(withTitle: name)
        id = req.placeholderForCreatedAssetCollection.localIdentifier
      } completionHandler: { ok, err in
        ok ? c.resume() : c.resume(throwing: ClipperError.exportFailed(err?.localizedDescription ?? "建相册失败"))
      }
    }
    guard let id else { return nil }
    return PHAssetCollection.fetchAssetCollections(withLocalIdentifiers: [id], options: nil).firstObject
  }

  private func safeName(_ raw: String) -> String {
    let cleaned = raw.replacingOccurrences(of: "/", with: "-")
      .replacingOccurrences(of: ":", with: "-")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    return cleaned.isEmpty ? "片段" : String(cleaned.prefix(40))
  }
}
