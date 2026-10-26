/** Public, unsigned development fixture. Never points at a live merchant. */
export function x402Fixture() {
  return { requestId: 'x402-1', resourceUrl: 'https://merchant.example.com/weather?city=Halifax', paymentRequired: {
    x402Version: 2, resource: { url: 'https://merchant.example.com/weather?city=Halifax', description: 'Weather data', mimeType: 'application/json' },
    accepts: [{ scheme: 'exact', network: 'eip155:84532', amount: '10000', asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      payTo: '0x3333333333333333333333333333333333333333', maxTimeoutSeconds: 60, extra: { name: 'USDC', version: '2' } }],
  } }
}
