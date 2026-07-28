import UIKit

/**
 * 让底边的系统手势「延后生效」。
 *
 * 横屏时沿底边横向滑动本身就是 iOS 的切换 app 手势，而进度条正好在底部，
 * 两者动作完全重合 —— 单靠把控件往上挪解决不了。UIKit 给的正解是
 * preferredScreenEdgesDeferringSystemGestures：开启后第一次滑动只唤出
 * home 指示条，再滑一次才真的切走，视频类 app 普遍这么做。
 *
 * 它是 UIViewController 上的只读属性，只能由子类重写。RN 的根控制器不归我们所有，
 * 所以用一次性的方法交换来接管它的取值。
 */
final class EdgeGestureGuard {
  static var enabled = false
  private static var installed = false

  static func install() {
    guard !installed else { return }
    guard
      let original = class_getInstanceMethod(
        UIViewController.self,
        #selector(getter: UIViewController.preferredScreenEdgesDeferringSystemGestures)),
      let replacement = class_getInstanceMethod(
        UIViewController.self,
        #selector(UIViewController.clipper_deferredScreenEdges))
    else { return }
    method_exchangeImplementations(original, replacement)
    installed = true
  }

  /// 通知 UIKit 重新读取该属性
  static func refresh() {
    guard let root = keyRootViewController() else { return }
    root.setNeedsUpdateOfScreenEdgesDeferringSystemGestures()
  }

  private static func keyRootViewController() -> UIViewController? {
    if #available(iOS 13, *) {
      return UIApplication.shared.connectedScenes
        .compactMap { $0 as? UIWindowScene }
        .flatMap { $0.windows }
        .first { $0.isKeyWindow }?
        .rootViewController
    }
    return UIApplication.shared.keyWindow?.rootViewController
  }
}

extension UIViewController {
  @objc dynamic func clipper_deferredScreenEdges() -> UIRectEdge {
    if EdgeGestureGuard.enabled { return .bottom }
    // 交换之后，这里走到的是系统原本的实现
    return self.clipper_deferredScreenEdges()
  }
}
