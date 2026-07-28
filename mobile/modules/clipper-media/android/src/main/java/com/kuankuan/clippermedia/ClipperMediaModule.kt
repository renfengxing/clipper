package com.kuankuan.clippermedia

import android.content.ContentValues
import android.graphics.Color
import android.graphics.Rect
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.text.SpannableString
import android.text.Spanned
import android.text.style.AbsoluteSizeSpan
import android.text.style.ForegroundColorSpan
import android.text.style.StyleSpan
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.Effect
import androidx.media3.effect.OverlayEffect
import androidx.media3.effect.OverlaySettings
import androidx.media3.effect.TextOverlay
import androidx.media3.effect.TextureOverlay
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import com.google.common.collect.ImmutableList
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.records.Record
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.Dispatchers
import java.io.File
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

// MARK: - 入参（与 iOS 侧保持同名同形）

class SegmentInput : Record {
  @Field var sourcePath: String = ""
  @Field var start: Double = 0.0
  @Field var end: Double = 0.0
}

class ClipInput : Record {
  @Field var id: String = ""
  @Field var sourcePath: String = ""
  @Field var start: Double = 0.0
  @Field var end: Double = 0.0
  @Field var title: String = ""
  @Field var segments: List<SegmentInput> = emptyList()
}

class ExportOptions : Record {
  @Field var albumName: String = "宽宽爸视频切片"
  @Field var clips: List<ClipInput> = emptyList()
  @Field var burnSubtitle: Boolean = true
  @Field var watermark: String = ""
}

class MergeOptions : Record {
  @Field var albumName: String = "宽宽爸视频切片"
  @Field var name: String = "合并"
  @Field var clips: List<ClipInput> = emptyList()
  @Field var burnSubtitle: Boolean = true
  @Field var watermark: String = ""
}

class ClipperException(message: String) : Exception(message)

/**
 * Android 侧的裁剪 / 合并 / 字幕烧录，对应 iOS 的 AVFoundation 实现。
 *
 * 用 Media3 Transformer 而不是 ffmpeg-kit：后者已停止分发预编译产物，
 * 自行编译并维护多架构产物的成本远超收益。Transformer 原生支持裁剪、
 * 多段拼接与图层叠加，且能在无叠加时走「不转码」的直通路径。
 */
class ClipperMediaModule : Module() {
  private val main = Handler(Looper.getMainLooper())

  override fun definition() = ModuleDefinition {
    Name("ClipperMedia")

    Events("onProgress")

    // Android 的底部是手势导航区，和 iOS 的问题一样：进度条贴着底边会误触发。
    // 用 systemGestureExclusionRects 把底部一条划归应用自己处理。
    Function("setDeferBottomGesture") { on: Boolean ->
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        main.post {
          val decor = appContext.currentActivity?.window?.decorView ?: return@post
          decor.systemGestureExclusionRects =
            if (on) {
              val h = (96 * decor.resources.displayMetrics.density).toInt()
              listOf(Rect(0, decor.height - h, decor.width, decor.height))
            } else {
              emptyList()
            }
        }
      }
    }

    AsyncFunction("exportClips") Coroutine { options: ExportOptions ->
      val ids = mutableListOf<String>()
      val total = options.clips.size
      options.clips.forEachIndexed { i, clip ->
        val labels = if (options.burnSubtitle && clip.title.isNotEmpty()) clip.title else null
        val file = renderOne(clip, labels, options.watermark) { p ->
          emitProgress(i, total, clip.title, p)
        }
        saveToGallery(file, options.albumName, safeName(clip.title))
        file.delete()
        ids.add(clip.id)
        emitProgress(i, total, clip.title, 1.0)
      }
      mapOf("ok" to true, "count" to ids.size, "ids" to ids)
    }

    AsyncFunction("mergeClips") Coroutine { options: MergeOptions ->
      val file = renderMerged(options) { p -> emitProgress(0, 1, options.name, p) }
      saveToGallery(file, options.albumName, safeName(options.name))
      file.delete()
      mapOf("ok" to true, "name" to options.name)
    }
  }

  private fun emitProgress(index: Int, total: Int, name: String, progress: Double) {
    sendEvent(
      "onProgress",
      mapOf("index" to index, "total" to total, "name" to name, "progress" to progress)
    )
  }

  // MARK: - 组装

  private fun segmentsOf(clip: ClipInput): List<SegmentInput> =
    clip.segments.ifEmpty {
      listOf(SegmentInput().apply {
        sourcePath = clip.sourcePath
        start = clip.start
        end = clip.end
      })
    }

  /** 一段来源 → 一个裁剪好的 EditedMediaItem */
  private fun itemOf(seg: SegmentInput, effects: Effects): EditedMediaItem {
    val uri = if (seg.sourcePath.startsWith("content://") || seg.sourcePath.startsWith("file://")) {
      Uri.parse(seg.sourcePath)
    } else {
      Uri.fromFile(File(seg.sourcePath))
    }
    val clipping = MediaItem.ClippingConfiguration.Builder()
      .setStartPositionMs((seg.start * 1000).toLong())
      .setEndPositionMs((seg.end * 1000).toLong())
      .build()
    val media = MediaItem.Builder().setUri(uri).setClippingConfiguration(clipping).build()
    return EditedMediaItem.Builder(media).setEffects(effects).build()
  }

  private fun effectsFor(subtitle: String?, watermark: String): Effects {
    val overlays = mutableListOf<TextureOverlay>()
    if (!subtitle.isNullOrEmpty()) overlays.add(textOverlay(subtitle, 0.86f, false))
    if (watermark.isNotEmpty()) overlays.add(textOverlay(watermark, 0.94f, true))
    if (overlays.isEmpty()) return Effects.EMPTY
    val list: ImmutableList<Effect> = ImmutableList.of(OverlayEffect(ImmutableList.copyOf(overlays)))
    return Effects(ImmutableList.of(), list)
  }

  /**
   * 字幕图层。yFrac 0=画面中央、1=底部，用锚点换算成 Media3 的坐标系（-1..1，-1 为下）。
   * dim=水印，小一号且半透明，靠右下。
   */
  private fun textOverlay(text: String, yFrac: Float, dim: Boolean): TextOverlay {
    val span = SpannableString(text)
    span.setSpan(ForegroundColorSpan(if (dim) Color.argb(150, 255, 255, 255) else Color.WHITE),
      0, text.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    span.setSpan(AbsoluteSizeSpan(if (dim) 32 else 56), 0, text.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    if (!dim) span.setSpan(StyleSpan(android.graphics.Typeface.BOLD), 0, text.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)

    val settings = OverlaySettings.Builder()
      .setOverlayFrameAnchor(if (dim) 1f else 0f, -1f)
      .setBackgroundFrameAnchor(if (dim) 0.92f else 0f, -(yFrac * 2 - 1f))
      .build()
    return TextOverlay.createStaticTextOverlay(span, settings)
  }

  private suspend fun renderOne(
    clip: ClipInput,
    subtitle: String?,
    watermark: String,
    onProgress: (Double) -> Unit
  ): File {
    val effects = effectsFor(subtitle, watermark)
    val items = segmentsOf(clip).map { itemOf(it, effects) }
    if (items.isEmpty()) throw ClipperException("「${clip.title}」没有可导出的片段")
    val composition = Composition.Builder(EditedMediaItemSequence(items)).build()
    return runTransformer(composition, safeName(clip.title), onProgress)
  }

  private suspend fun renderMerged(options: MergeOptions, onProgress: (Double) -> Unit): File {
    val items = mutableListOf<EditedMediaItem>()
    options.clips.forEach { clip ->
      // 每个片段带自己的字幕：Media3 允许逐个 item 配不同的 effects，
      // 不必像 AVFoundation 那样用关键帧控制显隐
      val subtitle = if (options.burnSubtitle && clip.title.isNotEmpty()) clip.title else null
      val effects = effectsFor(subtitle, options.watermark)
      segmentsOf(clip).forEach { items.add(itemOf(it, effects)) }
    }
    if (items.isEmpty()) throw ClipperException("没有可合并的片段")
    val composition = Composition.Builder(EditedMediaItemSequence(items)).build()
    return runTransformer(composition, safeName(options.name), onProgress)
  }

  private suspend fun runTransformer(
    composition: Composition,
    baseName: String,
    onProgress: (Double) -> Unit
  ): File = withContext(Dispatchers.Main) {
    val ctx = appContext.reactContext ?: throw ClipperException("上下文不可用")
    val out = File(ctx.cacheDir, "$baseName-${System.currentTimeMillis()}.mp4")

    suspendCancellableCoroutine { cont ->
      val transformer = Transformer.Builder(ctx)
        .setVideoMimeType(MimeTypes.VIDEO_H264)
        .setAudioMimeType(MimeTypes.AUDIO_AAC)
        .addListener(object : Transformer.Listener {
          override fun onCompleted(c: Composition, result: ExportResult) {
            if (cont.isActive) cont.resume(out)
          }

          override fun onError(c: Composition, result: ExportResult, e: ExportException) {
            if (cont.isActive) cont.resumeWithException(ClipperException(e.message ?: "导出失败"))
          }
        })
        .build()

      // 进度轮询：Transformer 只提供拉取式的进度
      val holder = ProgressHolder()
      val ticker = object : Runnable {
        override fun run() {
          if (!cont.isActive) return
          if (transformer.getProgress(holder) == Transformer.PROGRESS_STATE_AVAILABLE) {
            onProgress(holder.progress / 100.0)
          }
          main.postDelayed(this, 300)
        }
      }
      main.postDelayed(ticker, 300)

      cont.invokeOnCancellation {
        main.removeCallbacks(ticker)
        transformer.cancel()
        out.delete()
      }

      transformer.start(composition, out.absolutePath)
    }
  }

  // MARK: - 写回相册

  private suspend fun saveToGallery(file: File, album: String, displayName: String) =
    withContext(Dispatchers.IO) {
      val ctx = appContext.reactContext ?: throw ClipperException("上下文不可用")
      val resolver = ctx.contentResolver
      val name = "$displayName-${System.currentTimeMillis()}.mp4"
      val values = ContentValues().apply {
        put(MediaStore.Video.Media.DISPLAY_NAME, name)
        put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          put(MediaStore.Video.Media.RELATIVE_PATH, "${Environment.DIRECTORY_MOVIES}/$album")
          put(MediaStore.Video.Media.IS_PENDING, 1)
        }
      }
      val uri = resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values)
        ?: throw ClipperException("写入相册失败：拿不到目标地址")
      resolver.openOutputStream(uri)?.use { os -> file.inputStream().use { it.copyTo(os) } }
        ?: throw ClipperException("写入相册失败：打不开输出流")
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        values.clear()
        values.put(MediaStore.Video.Media.IS_PENDING, 0)
        resolver.update(uri, values, null, null)
      }
    }

  private fun safeName(raw: String): String {
    val cleaned = raw.replace("/", "-").replace(":", "-").trim()
    return if (cleaned.isEmpty()) "片段" else cleaned.take(40)
  }
}
