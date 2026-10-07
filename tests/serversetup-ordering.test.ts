import ServerSetup from '../src/commands/serversetup'
import StdOutUtil from '../src/utils/StdOutUtil'
import { ParamType } from '../src/commands/Command'

const events: string[] = []

let acmeResponse: any = { challengeType: 'http-01' }

const mockApi = {
    getAuthToken: jest.fn(async () => {
        events.push('api:getAuthToken')
        return 'test-auth-token'
    }),
    getCaptainInfo: jest.fn(async () => {
        events.push('api:getCaptainInfo')
        return {}
    }),
    getAcmeConfig: jest.fn(async () => {
        events.push('api:getAcmeConfig')
        return acmeResponse
    }),
    setCloudflareToken: jest.fn(async () => {
        events.push('api:setCloudflareToken')
    }),
    updateAcmeConfig: jest.fn(async () => {
        events.push('api:updateAcmeConfig')
    }),
    updateRootDomain: jest.fn(async () => {
        events.push('api:updateRootDomain')
    }),
    enableRootSsl: jest.fn(async () => {
        events.push('api:enableRootSsl')
    }),
    forceSsl: jest.fn(async () => {
        events.push('api:forceSsl')
    }),
    changePass: jest.fn(async () => {
        events.push('api:changePass')
    })
}

jest.mock('../src/api/CliApiManager', () => ({
    __esModule: true,
    default: {
        get: jest.fn(() => mockApi)
    }
}))

const mockInquirerPrompt = jest.fn()

jest.mock('inquirer', () => ({
    __esModule: true,
    default: {
        prompt: (...args: any[]) => mockInquirerPrompt(...args)
    }
}))

// Builds the alias table exactly the way Command.build/action does, so the
// test below drives the REAL private getParams loop (prompts, when()
// evaluation, preProcessParam sequencing) rather than calling option
// callbacks one by one.
function resolveThroughRealGetParams(
    cmd: any,
    cmdLineOptions: Record<string, any>
) {
    const definitions: any[] = cmd.options()
    const aliases = definitions
        .filter((option: any) => option && option.name)
        .reduce(
            (acc: any[], option: any) => [
                ...acc,
                { ...option, aliasTo: option.name },
                ...((option.aliases || [])
                    .filter((alias: any) => alias && alias.name)
                    .map((alias: any) => ({ ...alias, aliasTo: option.name })))
            ],
            []
        )
    return (cmd as any).getParams(cmdLineOptions, aliases)
}

describe('serversetup real option-processing order', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        events.length = 0
        delete process.env.CAPROVER_CONFIG_FILE
        // NOTE: do NOT re-arm mockApi methods with bare mockResolvedValue
        // here: that would replace the event-recording implementations
        // above and silently blind every ordering assertion. Per-test
        // overrides use mockRejectedValueOnce (one-shot) or the mutable
        // acmeResponse holder instead.
        acmeResponse = { challengeType: 'http-01' }
        mockInquirerPrompt.mockImplementation(async (questions: any[]) => {
            const name = questions && questions[0] && questions[0].name
            const scripted: Record<string, any> = {
                assumeYes: true,
                caproverIP: '1.2.3.4',
                caproverRootDomain: 'example.com',
                acmeChallenge: 'dns-01',
                cloudflareApiToken: 'order-test-token',
                newPassword: 'new-password-123',
                newPasswordCheck: 'new-password-123',
                certificateEmail: 'admin@example.com',
                caproverName: 'testmachine'
            }
            if (!(name in scripted)) {
                throw new Error(`unexpected prompt for ${name}`)
            }
            events.push(`prompt:${name}`)
            return { [name]: scripted[name] }
        })
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    test('DNS-01: domain collected, ACME processed, then token, config, domain', async () => {
        const cmd = new ServerSetup({} as any)
        await resolveThroughRealGetParams(cmd, {})

        // The root-domain step itself must not touch the domain API: the
        // only updateRootDomain call in the whole run happens here, after
        // ACME selection, token storage, and config persistence.
        expect(mockApi.updateRootDomain).toHaveBeenCalledTimes(1)
        expect(mockApi.updateRootDomain).toHaveBeenCalledWith('example.com')

        // eslint-disable-next-line no-console
        console.log(
            'DBG-CALLS getAuthToken=' +
                mockApi.getAuthToken.mock.calls.length +
                ' getAcmeConfig=' +
                mockApi.getAcmeConfig.mock.calls.length +
                ' prompt=' +
                mockInquirerPrompt.mock.calls.length
        )
        const promptAcme = events.indexOf('prompt:acmeChallenge')
        const promptToken = events.indexOf('prompt:cloudflareApiToken')
        const tokenPost = events.indexOf('api:setCloudflareToken')
        const configPost = events.indexOf('api:updateAcmeConfig')
        const domainPost = events.indexOf('api:updateRootDomain')
        const sslPost = events.indexOf('api:enableRootSsl')

        for (const [label, index] of Object.entries({
            promptAcme,
            promptToken,
            tokenPost,
            configPost,
            domainPost,
            sslPost
        })) {
            expect([label, index]).toEqual([label, expect.any(Number)])
            expect(index).toBeGreaterThanOrEqual(0)
        }
        expect(promptAcme).toBeLessThan(promptToken)
        expect(promptToken).toBeLessThan(tokenPost)
        expect(tokenPost).toBeLessThan(configPost)
        expect(configPost).toBeLessThan(domainPost)
        expect(domainPost).toBeLessThan(sslPost)

        expect(mockApi.updateAcmeConfig).toHaveBeenCalledWith(
            'dns-01',
            'cloudflare'
        )
        expect(mockApi.setCloudflareToken).toHaveBeenCalledWith(
            'order-test-token'
        )
    })

    test('HTTP-01: no token prompt, no token or config POST, domain after choice', async () => {
        mockInquirerPrompt.mockImplementation(async (questions: any[]) => {
            const name = questions && questions[0] && questions[0].name
            const scripted: Record<string, any> = {
                assumeYes: true,
                caproverIP: '1.2.3.4',
                caproverRootDomain: 'example.com',
                acmeChallenge: 'http-01',
                newPassword: 'new-password-123',
                newPasswordCheck: 'new-password-123',
                certificateEmail: 'admin@example.com',
                caproverName: 'testmachine'
            }
            if (!(name in scripted)) {
                throw new Error(`unexpected prompt for ${name}`)
            }
            events.push(`prompt:${name}`)
            return { [name]: scripted[name] }
        })

        const cmd = new ServerSetup({} as any)
        await resolveThroughRealGetParams(cmd, {})

        expect(events).not.toContain('prompt:cloudflareApiToken')
        expect(mockApi.setCloudflareToken).not.toHaveBeenCalled()
        expect(mockApi.updateAcmeConfig).not.toHaveBeenCalled()

        const promptAcme = events.indexOf('prompt:acmeChallenge')
        const domainPost = events.indexOf('api:updateRootDomain')
        expect(promptAcme).toBeGreaterThanOrEqual(0)
        expect(domainPost).toBeGreaterThan(promptAcme)
        expect(mockApi.enableRootSsl).toHaveBeenCalledWith(
            'admin@example.com'
        )
    })

    test('token API failure stops the flow before config and domain', async () => {
        const processExit = new Error('__process_exit__')
        jest.spyOn(process, 'exit').mockImplementation((() => {
            throw processExit
        }) as any)
        const errorSpy = jest.spyOn(StdOutUtil, 'printError')
        mockInquirerPrompt.mockImplementation(async (questions: any[]) => {
            const name = questions && questions[0] && questions[0].name
            const scripted: Record<string, any> = {
                assumeYes: true,
                caproverIP: '1.2.3.4',
                caproverRootDomain: 'example.com',
                acmeChallenge: 'dns-01',
                cloudflareApiToken: 'order-test-token',
                certificateEmail: 'admin@example.com',
                caproverName: 'testmachine'
            }
            if (!(name in scripted)) {
                throw new Error(`unexpected prompt for ${name}`)
            }
            events.push(`prompt:${name}`)
            return { [name]: scripted[name] }
        })
        mockApi.setCloudflareToken.mockRejectedValueOnce(
            new Error('denied')
        )

        const cmd = new ServerSetup({} as any)
        await expect(resolveThroughRealGetParams(cmd, {})).rejects.toBe(
            processExit
        )

        expect(mockApi.updateAcmeConfig).not.toHaveBeenCalled()
        expect(mockApi.updateRootDomain).not.toHaveBeenCalled()
        const printed = errorSpy.mock.calls.map((call) => String(call[0]))
        expect(
            printed.some((text) => text.includes('order-test-token'))
        ).toBe(false)
    })
})
