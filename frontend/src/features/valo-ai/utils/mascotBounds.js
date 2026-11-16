// All coordinates are CSS pixels in the fixed-position viewport.
export function mascotBounds(content, mascot, viewport) {
  const left = Math.max(viewport.left, content.left);
  const top = Math.max(viewport.top, content.top);
  const right = Math.min(viewport.right, content.right);
  const bottom = Math.min(viewport.bottom, content.bottom);
  return {
    minX: left, minY: top,
    maxX: Math.max(left, right - mascot.width),
    maxY: Math.max(top, bottom - mascot.height),
    fits: mascot.width > 0 && mascot.height > 0 && right - left >= mascot.width && bottom - top >= mascot.height,
  };
}

export function clampMascot(position, bounds) {
  return {
    x: Math.max(bounds.minX, Math.min(Number.isFinite(position?.x) ? position.x : bounds.maxX, bounds.maxX)),
    y: Math.max(bounds.minY, Math.min(Number.isFinite(position?.y) ? position.y : bounds.maxY, bounds.maxY)),
  };
}

export function measureMascotBounds(content, mascot, viewportWindow = window) {
  if (!content || !mascot) return null;
  const visual = viewportWindow.visualViewport;
  const left = visual?.offsetLeft || 0;
  const top = visual?.offsetTop || 0;
  const viewport = {
    left, top,
    right: left + (visual?.width ?? viewportWindow.document.documentElement.clientWidth),
    bottom: top + (visual?.height ?? viewportWindow.document.documentElement.clientHeight),
  };
  return mascotBounds(content.getBoundingClientRect(), mascot.getBoundingClientRect(), viewport);
}

export function observeMascotBounds(content, mascot, revalidate, viewportWindow = window) {
  const observer = new viewportWindow.ResizeObserver(revalidate);
  if (content) observer.observe(content);
  if (mascot) observer.observe(mascot);
  viewportWindow.addEventListener('resize', revalidate);
  // Capture scrolls of ancestors too, including content moved by a responsive shell.
  viewportWindow.addEventListener('scroll', revalidate, true);
  viewportWindow.visualViewport?.addEventListener('resize', revalidate);
  viewportWindow.visualViewport?.addEventListener('scroll', revalidate);
  return () => {
    observer.disconnect();
    viewportWindow.removeEventListener('resize', revalidate);
    viewportWindow.removeEventListener('scroll', revalidate, true);
    viewportWindow.visualViewport?.removeEventListener('resize', revalidate);
    viewportWindow.visualViewport?.removeEventListener('scroll', revalidate);
  };
}
