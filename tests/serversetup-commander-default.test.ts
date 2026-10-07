import { Command } from 'commander'
import ServerSetup from '../src/commands/serversetup'

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

// Replicates exactly what Command.build/action does with Commander defaults:
// build() calls getOptions() with NO params, registers each non-hidden
// option via cmd.option(flags, desc, defaultValue), and Commander injects
// every defined defaultValue into commanderCommand.opts() even when the
// user passed no flag. getParams then treats each injected key as
// ParamType.CommandLine and skips the prompt for it.
function commanderOptsForNoArgs(cmd: any): Record<string, any> {
    const program = new Command()
    const holder: { sub?: any } = {}
    const origCommand = program.command.bind(program)
    // Capture the subcommand created by build() without running its action.
    ;(program as any).command = (name: string) => {
        const sub = origCommand(name)
        holder.sub = sub
        return sub
    }
    cmd.__testProgram = program
    const built = new (cmd.constructor as any)(program)
    built.build()
    const sub = holder.sub
    const opts: Record<string, any> = {}
    for (const o of sub.options as any[]) {
        const key =
            o.attributeName && o.attributeName()
                ? o.attributeName()
                : o.long.replace(/^--/, '')
        if (o.defaultValue !== undefined) {
            opts[key] = o.defaultValue
        }
    }
    return opts
}

function aliasesFor(cmd: any) {
    const definitions: any[] = cmd.options()
    return definitions
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
}

describe('serversetup commander default regression', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        events.length = 0
        delete process.env.CAPROVER_CONFIG_FILE
        delete process.env.CAPROVER_ACME_CHALLENGE
        acmeResponse = { challengeType: 'http-01' }
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
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    test('no-arg Commander opts must not pre-answer acmeChallenge', () => {
        const cmd = new ServerSetup({} as any)
        const opts = commanderOptsForNoArgs(cmd)
        // The real E2E ran with no flags; Commander must not inject the
        // challenge default or getParams will treat it as user input and
        // skip the ACME prompt entirely (observed 1107 with no prompt).
        expect(opts).not.toHaveProperty('acmeChallenge')
    })

    test('real Commander opts path still prompts for ACME before domain', async () => {
        const cmd = new ServerSetup({} as any)
        const opts = commanderOptsForNoArgs(cmd)
        await (cmd as any).getParams(opts, aliasesFor(cmd))

        // With genuine no-arg opts, the ACME question must be asked and the
        // domain API must run strictly after it.
        expect(events).toContain('prompt:acmeChallenge')
        const promptAcme = events.indexOf('prompt:acmeChallenge')
        const domainPost = events.indexOf('api:updateRootDomain')
        expect(promptAcme).toBeGreaterThanOrEqual(0)
        expect(domainPost).toBeGreaterThan(promptAcme)
        expect(mockApi.updateRootDomain).toHaveBeenCalledWith('example.com')
    })
})
