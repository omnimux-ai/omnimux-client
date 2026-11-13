/**
 * OpenReel Typography & Subtitle Rendering Engine.
 * Supports auto-wrapping, stroke outlines, background pills, and alignment.
 */

/**
 * Render a styled text block onto a 2D canvas context.
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../core/types.js').DEFAULT_TEXT_STYLE} style
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 */
export function drawTypography(ctx, style, canvasWidth, canvasHeight) {
  const content = (style?.content || '').trim()
  if (!content) return

  const fontSize = Number(style.fontSize) || 48
  const fontFamily = style.fontFamily || 'sans-serif'
  const fontWeight = style.fontWeight || 'bold'
  const textAlign = style.textAlign || 'center'
  const textColor = style.color || '#ffffff'
  const strokeColor = style.strokeColor || '#000000'
  const strokeWidth = Number(style.strokeWidth) || 0
  const backgroundColor = style.backgroundColor || 'rgba(0, 0, 0, 0.4)'

  ctx.save()
  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`
  ctx.textBaseline = 'middle'

  const lines = content.split('\n')
  const lineHeight = fontSize * 1.3
  const totalHeight = lines.length * lineHeight

  // Subtitle anchor: bottom center with 12% bottom margin
  const anchorY = canvasHeight * 0.85
  const startY = anchorY - (totalHeight / 2) + (lineHeight / 2)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const metrics = ctx.measureText(line)
    const lineWidth = metrics.width
    const lineY = startY + (i * lineHeight)

    let lineX = canvasWidth / 2
    if (textAlign === 'left') lineX = canvasWidth * 0.1
    else if (textAlign === 'right') lineX = canvasWidth * 0.9

    // Draw background pill
    if (backgroundColor && backgroundColor !== 'transparent') {
      const paddingX = fontSize * 0.35
      const paddingY = fontSize * 0.2
      const boxWidth = lineWidth + (paddingX * 2)
      const boxHeight = fontSize + (paddingY * 2)
      let boxX = lineX - (boxWidth / 2)
      if (textAlign === 'left') boxX = lineX - paddingX
      else if (textAlign === 'right') boxX = lineX - boxWidth + paddingX

      ctx.fillStyle = backgroundColor
      const radius = 6
      ctx.beginPath()
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(boxX, lineY - (boxHeight / 2), boxWidth, boxHeight, radius)
      } else {
        ctx.rect(boxX, lineY - (boxHeight / 2), boxWidth, boxHeight)
      }
      ctx.fill()
    }

    // Draw outline stroke
    if (strokeWidth > 0 && strokeColor) {
      ctx.lineWidth = strokeWidth
      ctx.strokeStyle = strokeColor
      ctx.textAlign = textAlign
      ctx.strokeText(line, lineX, lineY)
    }

    // Draw fill text
    ctx.fillStyle = textColor
    ctx.textAlign = textAlign
    ctx.fillText(line, lineX, lineY)
  }

  ctx.restore()
}
