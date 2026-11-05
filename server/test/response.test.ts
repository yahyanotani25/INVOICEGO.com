import { describe, expect, it } from 'vitest';
import { classifyResponse } from '../src/fbr/response';

// Bodies copied from the spec v1.12 samples (§4.1.3, §4.1.4, §4.1.5, §4.2.3).
const VALID_POST = `{"invoiceNumber":"7000007DI1747119701593","dated":"2025-05-13 12:01:41","validationResponse":{"statusCode":"00","status":"Valid","error":"","invoiceStatuses":[{"itemSNo":"1","statusCode":"00","status":"Valid","invoiceNo":"7000007DI1747119701593-1","errorCode":"","error":""}]}}`;
const INVALID_1 = `{"dated":"2025-05-13 13:09:05","validationResponse":{"statusCode":"01","status":"Invalid","errorCode":"0052","error":"Provide proper HS Code with invoice no. null","invoiceStatuses":null}}`;
const INVALID_2 = `{"dated":"2025-05-13 13:10:00","validationResponse":{"statusCode":"00","status":"invalid","error":"","invoiceStatuses":[{"itemSNo":"1","statusCode":"01","status":"Invalid","invoiceNo":null,"errorCode":"0046","error":"Provide rate."}]}}`;
const VALID_VALIDATE = `{"dated":"2025-05-13 13:13:07","validationResponse":{"statusCode":"00","status":"Valid","errorCode":null,"error":"","invoiceStatuses":[{"itemSNo":"1","statusCode":"00","status":"Valid","errorCode":null,"error":""}]}}`;

describe('FBR response classification', () => {
  it('§4.1.3 valid post -> VALID with FBR invoice number', () => {
    const c = classifyResponse('POST', 200, VALID_POST, 1);
    expect(c.outcome).toBe('VALID');
    expect(c.invoiceNumber).toBe('7000007DI1747119701593');
    expect(c.items[0].invoiceNo).toBe('7000007DI1747119701593-1');
  });
  it('§4.2.3 valid validation -> VALID', () => {
    expect(classifyResponse('VALIDATE', 200, VALID_VALIDATE, 1).outcome).toBe('VALID');
  });
  it('§4.1.4 header invalid -> INVALID with code 0052', () => {
    const c = classifyResponse('POST', 200, INVALID_1, 1);
    expect(c.outcome).toBe('INVALID');
    expect(c.issues[0]).toMatchObject({ scope: 'INVOICE', code: '0052' });
  });
  it('§4.1.5 header "00" + item "01" is INVALID, never VALID (HTTP 200 alone is not success)', () => {
    const c = classifyResponse('POST', 200, INVALID_2, 1);
    expect(c.outcome).toBe('INVALID');
    expect(c.issues).toContainEqual(expect.objectContaining({ scope: 'ITEM', itemSNo: '1', code: '0046' }));
    expect(classifyResponse('VALIDATE', 200, INVALID_2, 1).outcome).toBe('INVALID');
  });
  it('401 -> AUTH_ERROR', () => {
    expect(classifyResponse('POST', 401, '', 1).outcome).toBe('AUTH_ERROR');
  });
  it('500 -> UNCERTAIN for POST, HTTP_ERROR for VALIDATE', () => {
    expect(classifyResponse('POST', 500, 'oops', 1).outcome).toBe('UNCERTAIN');
    expect(classifyResponse('VALIDATE', 500, 'oops', 1).outcome).toBe('HTTP_ERROR');
  });
  it('200 non-JSON on POST -> UNCERTAIN', () => {
    expect(classifyResponse('POST', 200, '<html>gateway</html>', 1).outcome).toBe('UNCERTAIN');
    expect(classifyResponse('VALIDATE', 200, '<html>gateway</html>', 1).outcome).toBe('BAD_RESPONSE');
  });
  it('valid header/items but missing invoiceNumber on POST -> UNCERTAIN', () => {
    const body = JSON.parse(VALID_POST);
    delete body.invoiceNumber;
    expect(classifyResponse('POST', 200, JSON.stringify(body), 1).outcome).toBe('UNCERTAIN');
  });
  it('item count mismatch is not VALID', () => {
    expect(classifyResponse('VALIDATE', 200, VALID_VALIDATE, 2).outcome).not.toBe('VALID');
    expect(classifyResponse('POST', 200, VALID_POST, 2).outcome).not.toBe('VALID');
  });
  it('numeric status codes are normalised', () => {
    const body = JSON.parse(VALID_VALIDATE);
    body.validationResponse.statusCode = 0;
    body.validationResponse.invoiceStatuses[0].statusCode = 0;
    expect(classifyResponse('VALIDATE', 200, JSON.stringify(body), 1).outcome).toBe('VALID');
  });
});
