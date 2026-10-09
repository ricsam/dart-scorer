export const PROFILE_PICTURE_MAX_BYTES = 10 * 1024 * 1024

/** Local-only preview; never send a data URL to a list API or persist one. */
export async function prepareProfilePicture(file: File): Promise<{ blob: Blob; preview: string }> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPG, PNG or WebP picture.')
  if (!file.size || file.size > PROFILE_PICTURE_MAX_BYTES) throw new Error('Choose a picture no larger than 10 MB.')
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('This picture could not be read. Try another file.') })
  try {
    if (bitmap.width * bitmap.height > 40_000_000) throw new Error('Choose a picture under 40 megapixels.')
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 256
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Picture editing is not available in this browser.')
    const side = Math.min(bitmap.width, bitmap.height)
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Could not prepare this picture.')), 'image/png'))
    return { blob, preview: canvas.toDataURL('image/png') }
  } finally { bitmap.close() }
}
