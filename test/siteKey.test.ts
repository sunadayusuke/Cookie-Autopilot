import { describe, expect, it } from 'vitest';
import { siteKey } from '../src/shared/siteKey';

describe('siteKey', () => {
  it('通常のドメインは 2 ラベル残す', () => {
    expect(siteKey('www.tesla.com')).toBe('tesla.com');
    expect(siteKey('tesla.com')).toBe('tesla.com');
    expect(siteKey('a.b.c.example.com')).toBe('example.com');
  });

  it('2 段 TLD は 3 ラベル残す', () => {
    expect(siteKey('a.b.example.co.jp')).toBe('example.co.jp');
    expect(siteKey('shop.example.co.jp')).toBe('example.co.jp');
    expect(siteKey('www.example.co.uk')).toBe('example.co.uk');
    expect(siteKey('news.example.com.au')).toBe('example.com.au');
    expect(siteKey('example.ne.jp')).toBe('example.ne.jp');
  });

  it('単一ラベルはそのまま', () => {
    expect(siteKey('localhost')).toBe('localhost');
  });

  it('IP アドレスはそのまま', () => {
    expect(siteKey('127.0.0.1')).toBe('127.0.0.1');
    expect(siteKey('[::1]')).toBe('[::1]');
  });

  it('大文字・末尾ドット・空を正規化する', () => {
    expect(siteKey('WWW.Example.COM.')).toBe('example.com');
    expect(siteKey('')).toBe('');
    expect(siteKey(null)).toBe('');
  });
});
