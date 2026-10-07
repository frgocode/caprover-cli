import ApiManager from '../src/api/ApiManager'

describe('ApiManager ACME methods', () => {
    let api: ApiManager
    let fetch: jest.Mock
    let fetchData: any

    beforeEach(() => {
        fetchData = {}
        api = new ApiManager('http://1.2.3.4:3000/api/v2', undefined, () =>
            Promise.resolve()
        )
        // Mirror HttpClient.fetch's curried shape: fetch(...) returns the
        // actual request function consumed by Promise.then further up.
        fetch = jest
            .fn()
            .mockImplementation(() => () => Promise.resolve(fetchData))
        ;(api as any).http = {
            GET: 'GET',
            POST: 'POST',
            fetch
        }
    })

    test('getAcmeConfig reads the ACME configuration endpoint', async () => {
        fetchData = {
            challengeType: 'dns-01',
            dnsProvider: 'cloudflare',
            cloudflareTokenConfigured: true
        }

        const result = await api.getAcmeConfig()

        expect(fetch).toHaveBeenCalledWith('GET', '/user/system/acmeconfig', {})
        expect(result.cloudflareTokenConfigured).toBe(true)
    })

    test('setCloudflareToken posts the token without extra fields', async () => {
        await api.setCloudflareToken('cf-test-token')

        expect(fetch).toHaveBeenCalledWith(
            'POST',
            '/user/system/acmeconfig/cloudflare',
            { token: 'cf-test-token' }
        )
    })

    test('updateAcmeConfig persists DNS-01 with its provider', async () => {
        await api.updateAcmeConfig('dns-01', 'cloudflare')

        expect(fetch).toHaveBeenCalledWith('POST', '/user/system/acmeconfig', {
            challengeType: 'dns-01',
            dnsProvider: 'cloudflare'
        })
    })

    test('updateAcmeConfig persists a plain HTTP-01 switch', async () => {
        await api.updateAcmeConfig('http-01')

        expect(fetch).toHaveBeenCalledWith('POST', '/user/system/acmeconfig', {
            challengeType: 'http-01',
            dnsProvider: undefined
        })
    })
})
