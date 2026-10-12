import { describe, expect, it } from 'vitest'
import { avatarSources } from '../../src/online/format'

describe('avatarSources', () => {
  it('asks Google for a sharper sign-in picture and keeps the original as a fallback', () => {
    expect(avatarSources('https://lh3.googleusercontent.com/a/ACg8ocJx-abc=s96-c')).toEqual([
      'https://lh3.googleusercontent.com/a/ACg8ocJx-abc=s512-c',
      'https://lh3.googleusercontent.com/a/ACg8ocJx-abc=s96-c',
    ])
    expect(avatarSources('https://lh5.googleusercontent.com/a-/photo=s64')).toEqual([
      'https://lh5.googleusercontent.com/a-/photo=s512-c',
      'https://lh5.googleusercontent.com/a-/photo=s64',
    ])
  })

  it('leaves uploaded, unsized and other pictures alone', () => {
    expect(avatarSources('/api/avatars/user/version.webp')).toEqual(['/api/avatars/user/version.webp'])
    expect(avatarSources('https://lh3.googleusercontent.com/a/ACg8ocJx-abc')).toEqual(['https://lh3.googleusercontent.com/a/ACg8ocJx-abc'])
    expect(avatarSources('https://lh3.googleusercontent.com/a/ACg8ocJx-abc=s512-c')).toEqual(['https://lh3.googleusercontent.com/a/ACg8ocJx-abc=s512-c'])
    expect(avatarSources('https://evil.example/lh3.googleusercontent.com/a=s96-c')).toEqual(['https://evil.example/lh3.googleusercontent.com/a=s96-c'])
    expect(avatarSources('data:image/png;base64,AAAA')).toEqual(['data:image/png;base64,AAAA'])
    expect(avatarSources(null)).toEqual([])
    expect(avatarSources('')).toEqual([])
  })
})
