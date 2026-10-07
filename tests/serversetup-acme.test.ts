import ServerSetup from '../src/commands/serversetup'
import StdOutUtil from '../src/utils/StdOutUtil'
import { ParamType } from '../src/commands/Command'
import { Command as CommanderStatic } from 'commander'

const mockApi = {
    getAcmeConfig: jest.fn(),
    setCloudflareToken: jest.fn(),
    updateAcmeConfig: jest.fn(),
    updateRootDomain: jest.fn(),
    enableRootSsl: jest.fn(),
    forceSsl: jest.fn(),
    getAuthToken: jest.fn(),
    getCaptainInfo: jest.fn()
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

const TOKEN = 'cf-test-token-value'


function buildOptions() {
    const cmd = new ServerSetup({} as any)
    const options = ((cmd as any).options as (params?: any) => any[])()
    const byName: Record<string, any> = {}
    for (const option of options) {
        byName[option.name] = option
    }
    return { cmd, byName }
}

function silenceExit() {
    return jest.spyOn(process, 'exit').mockImplementation((() => {}) as any)
}

describe('serversetup ACME DNS-01 flow', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockApi.getAcmeConfig.mockRejectedValue(new Error('not found'))
        mockApi.setCloudflareToken.mockResolvedValue(undefined)
        mockApi.updateAcmeConfig.mockResolvedValue(undefined)
        mockApi.updateRootDomain.mockResolvedValue(undefined)
        mockApi.enableRootSsl.mockResolvedValue(undefined)
        mockApi.forceSsl.mockResolvedValue(undefined)
        mockApi.getAuthToken.mockResolvedValue('test-auth-token')
        mockApi.getCaptainInfo.mockResolvedValue({})
    })

    afterEach(() => {
        jest.restoreAllMocks()
        delete process.env.CAPROVER_IP
        delete process.env.CAPROVER_PASSWORD
        delete process.env.CAPROVER_ROOT_DOMAIN
        delete process.env.CAPROVER_ACME_CHALLENGE
        delete process.env.CAPROVER_CLOUDFLARE_API_TOKEN
        delete process.env.CAPROVER_CERTIFICATE_EMAIL
        delete process.env.CAPROVER_NAME
    })

    test('challenge prompt is asked on fresh setup with http-01 default', async () => {
        const { cmd, byName } = buildOptions()
        const challenge: any = byName.acmeChallenge

        expect(await challenge.when()).toBe(true)
        expect(challenge.default).toBe('http-01')
        expect(challenge.type).toBe('list')
        expect(challenge.validate('bogus')).not.toBe(true)
        expect(challenge.validate('http-01')).toBe(true)
        expect(challenge.validate('dns-01')).toBe(true)
        expect(cmd).toBeTruthy()
    })

    test('fresh DNS-01 posts token, then config, then root domain', async () => {
        const { cmd, byName } = buildOptions()

        await byName.caproverRootDomain.preProcessParam({
            value: 'example.com'
        })
        await byName.acmeChallenge.preProcessParam({ value: 'dns-01' })
        await byName.cloudflareApiToken.preProcessParam({ value: TOKEN })
        await byName.applyPendingRootDomain.preProcessParam()

        const order = [
            mockApi.setCloudflareToken.mock.invocationCallOrder[0],
            mockApi.updateAcmeConfig.mock.invocationCallOrder[0],
            mockApi.updateRootDomain.mock.invocationCallOrder[0]
        ]
        expect(mockApi.setCloudflareToken).toHaveBeenCalledWith(TOKEN)
        expect(mockApi.updateAcmeConfig).toHaveBeenCalledWith(
            'dns-01',
            'cloudflare'
        )
        expect(mockApi.updateRootDomain).toHaveBeenCalledWith('example.com')
        expect(order[0]).toBeLessThan(order[1])
        expect(order[1]).toBeLessThan(order[2])
        expect(cmd).toBeTruthy()
    })

    test('HTTP-01 default sends no ACME calls but still applies root domain', async () => {
        const { byName } = buildOptions()

        await byName.caproverRootDomain.preProcessParam({
            value: 'example.com'
        })
        await byName.acmeChallenge.preProcessParam({ value: 'http-01' })
        await byName.applyPendingRootDomain.preProcessParam()

        expect(mockApi.setCloudflareToken).not.toHaveBeenCalled()
        expect(mockApi.updateAcmeConfig).not.toHaveBeenCalled()
        expect(mockApi.updateRootDomain).toHaveBeenCalledWith('example.com')
    })

    test('token prompt is skipped when a token is already configured', async () => {
        mockApi.getAcmeConfig.mockResolvedValue({
            challengeType: 'dns-01',
            dnsProvider: 'cloudflare',
            cloudflareTokenConfigured: true
        })
        const { byName } = buildOptions()

        await byName.caproverRootDomain.preProcessParam({
            value: 'example.com'
        })

        expect(await byName.acmeChallenge.when()).toBe(false)
        await byName.acmeChallenge.preProcessParam(undefined)
        expect(await byName.cloudflareApiToken.when()).toBe(false)
        await byName.applyPendingRootDomain.preProcessParam()

        expect(mockApi.setCloudflareToken).not.toHaveBeenCalled()
        expect(mockApi.updateAcmeConfig).not.toHaveBeenCalled()
        expect(mockApi.updateRootDomain).toHaveBeenCalledWith('example.com')
    })

    test('explicit replacement token is posted before continuing', async () => {
        mockApi.getAcmeConfig.mockResolvedValue({
            challengeType: 'dns-01',
            dnsProvider: 'cloudflare',
            cloudflareTokenConfigured: true
        })
        const { byName } = buildOptions()

        await byName.caproverRootDomain.preProcessParam({
            value: 'example.com'
        })
        await byName.cloudflareApiToken.preProcessParam({
            value: '  replacement-token  '
        })

        expect(mockApi.setCloudflareToken).toHaveBeenCalledWith(
            'replacement-token'
        )
    })

    test('DNS-01 to HTTP-01 switch persists config without touching the token', async () => {
        mockApi.getAcmeConfig.mockResolvedValue({
            challengeType: 'dns-01',
            dnsProvider: 'cloudflare',
            cloudflareTokenConfigured: true
        })
        const { byName } = buildOptions()

        await byName.caproverRootDomain.preProcessParam({
            value: 'example.com'
        })
        await byName.acmeChallenge.preProcessParam({ value: 'http-01' })
        await byName.applyPendingRootDomain.preProcessParam()

        expect(mockApi.updateAcmeConfig).toHaveBeenCalledWith('http-01')
        expect(mockApi.setCloudflareToken).not.toHaveBeenCalled()
        expect(mockApi.updateRootDomain).toHaveBeenCalledWith('example.com')
    })

    test('token failure stops before config persist and domain apply', async () => {
        const exitSpy = silenceExit()
        const errorSpy = jest.spyOn(StdOutUtil, 'printError')
        mockApi.setCloudflareToken.mockRejectedValue(new Error('denied'))
        const { byName } = buildOptions()

        await byName.caproverRootDomain.preProcessParam({
            value: 'example.com'
        })
        await byName.acmeChallenge.preProcessParam({ value: 'dns-01' })
        await byName.cloudflareApiToken.preProcessParam({ value: TOKEN })

        expect(mockApi.updateAcmeConfig).not.toHaveBeenCalled()
        expect(mockApi.updateRootDomain).not.toHaveBeenCalled()
        expect(exitSpy).toHaveBeenCalled()
        const printed = errorSpy.mock.calls.map((call) => String(call[0]))
        expect(printed.some((text) => text.includes(TOKEN))).toBe(false)
    })

    test('stored token plus failed config persist reports accurately and stops', async () => {
        const exitSpy = silenceExit()
        const errorSpy = jest.spyOn(StdOutUtil, 'printError')
        mockApi.updateAcmeConfig.mockRejectedValue(new Error('db down'))
        const { byName } = buildOptions()

        await byName.caproverRootDomain.preProcessParam({
            value: 'example.com'
        })
        await byName.acmeChallenge.preProcessParam({ value: 'dns-01' })
        await byName.cloudflareApiToken.preProcessParam({ value: TOKEN })
        await byName.applyPendingRootDomain.preProcessParam()

        expect(mockApi.updateRootDomain).not.toHaveBeenCalled()
        expect(exitSpy).toHaveBeenCalled()
        const printed = errorSpy.mock.calls.map((call) => String(call[0]))
        expect(
            printed.some((text) => text.includes('Rerunning setup is safe'))
        ).toBe(true)
        expect(printed.some((text) => text.includes(TOKEN))).toBe(false)
    })

    test('token value never appears in stdout/stderr across the DNS-01 flow', async () => {
        const logs: string[] = []
        const logSpy = jest
            .spyOn(console, 'log')
            .mockImplementation((...args: any[]) => {
                logs.push(args.map((part) => String(part)).join(' '))
            })
        const errorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation((...args: any[]) => {
                logs.push(args.map((part) => String(part)).join(' '))
            })
        const { byName } = buildOptions()

        await byName.caproverRootDomain.preProcessParam({
            value: 'example.com'
        })
        await byName.acmeChallenge.preProcessParam({ value: 'dns-01' })
        await byName.cloudflareApiToken.preProcessParam({ value: TOKEN })
        await byName.applyPendingRootDomain.preProcessParam()

        expect(logs.some((line) => line.includes(TOKEN))).toBe(false)
        logSpy.mockRestore()
        errorSpy.mockRestore()
    })

    test('token option is masked, env-driven and hidden from argv', () => {
        const { byName } = buildOptions()
        const tokenOption: any = byName.cloudflareApiToken

        expect(tokenOption.type).toBe('password')
        expect(tokenOption.env).toBe('CAPROVER_CLOUDFLARE_API_TOKEN')
        expect(tokenOption.hide).toBe(true)
        expect(tokenOption.char).toBeUndefined()
    })

    test('serversetup help does not advertise token argv usage', () => {
        const program = new CommanderStatic()
        new ServerSetup(program as any).build()
        const subcommand = program.commands.find(
            (entry: any) =>
                entry.name() === 'serversetup' || entry.alias() === 'setup'
        )
        if (!subcommand) {
            throw new Error('serversetup subcommand was not registered')
        }
        const help = subcommand.helpInformation()

        expect(help).not.toContain('--cloudflareApiToken')
        expect(help).not.toContain('-t,')
        expect(help).toContain('--acmeChallenge')
        expect(help).toContain('CAPROVER_ACME_CHALLENGE')
    })

    test('CAPROVER_CLOUDFLARE_API_TOKEN resolves end to end without prompting', async () => {
        process.env.CAPROVER_IP = '1.2.3.4'
        process.env.CAPROVER_PASSWORD = 'current-pass'
        process.env.CAPROVER_ROOT_DOMAIN = 'example.com'
        process.env.CAPROVER_ACME_CHALLENGE = 'dns-01'
        process.env.CAPROVER_CLOUDFLARE_API_TOKEN = 'env-token-xyz'
        process.env.CAPROVER_CERTIFICATE_EMAIL = 'admin@example.com'
        process.env.CAPROVER_NAME = 'testmachine'
        mockInquirerPrompt.mockImplementation(async (questions: any[]) => {
            const name = questions && questions[0] && questions[0].name
            if (name === 'assumeYes') {
                return { assumeYes: true }
            }
            throw new Error(`unexpected prompt for ${name}`)
        })

        const cmd = new ServerSetup({} as any)
        const definitions: any[] = (cmd as any).options()
        const aliases = definitions
            .filter((option: any) => option && option.name)
            .reduce(
                (acc: any[], option: any) => [
                    ...acc,
                    { ...option, aliasTo: option.name },
                    ...((option.aliases || [])
                        .filter((alias: any) => alias && alias.name)
                        .map((alias: any) => ({
                            ...alias,
                            aliasTo: option.name
                        })))
                ],
                []
            )
        const params = await (cmd as any).getParams({}, aliases)

        expect(params.cloudflareApiToken.value).toBe('env-token-xyz')
        expect(params.cloudflareApiToken.from).toBe(ParamType.Env)
        const prompted = mockInquirerPrompt.mock.calls.map(
            (call) => call[0] && call[0][0] && call[0][0].name
        )
        expect(prompted).not.toContain('cloudflareApiToken')
        expect(mockApi.setCloudflareToken).toHaveBeenCalledWith(
            'env-token-xyz'
        )
        expect(mockApi.updateAcmeConfig).toHaveBeenCalledWith(
            'dns-01',
            'cloudflare'
        )
        expect(mockApi.updateRootDomain).toHaveBeenCalledWith('example.com')
        expect(mockApi.enableRootSsl).toHaveBeenCalledWith(
            'admin@example.com'
        )
    })
})
