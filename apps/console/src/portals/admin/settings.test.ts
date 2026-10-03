import { describe, expect, it } from 'vitest';
import { parseTerritories } from './Settings.tsx';

describe('territories editor', () => {
  it('accepts the documented shape and normalises codes', () => {
    expect(parseTerritories('{"blocked": ["us", "FR", "US"], "real_money_allowed": ["mt"]}')).toEqual({ value: { blocked: ['FR', 'US'], real_money_allowed: ['MT'] } });
    expect(parseTerritories('{}')).toEqual({ value: { blocked: [], real_money_allowed: [] } });
  });
  it('explains what is wrong', () => {
    expect(parseTerritories('{').error).toMatch(/Invalid JSON/);
    expect(parseTerritories('[]').error).toMatch(/JSON object/);
    expect(parseTerritories('{"RO": {"modes": ["play"]}}').error).toMatch(/Unknown key/);
    expect(parseTerritories('{"blocked": "US"}').error).toMatch(/list of country codes/);
    expect(parseTerritories('{"blocked": ["UK"]}').error).toMatch(/not an ISO 3166-1/);
    expect(parseTerritories('{"blocked": ["MT"], "real_money_allowed": ["MT"]}').error).toMatch(/both blocked and allowed/);
  });
});
