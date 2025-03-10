const executor = require('../../lib/flex')
const Helper = require('../../__fixtures__/unit/helper')
const { Action } = require('../../lib/actions/action')

describe('Test processBeforeValidate and processAfterValidate invocations', async () => {
  let context
  let registry = { validators: new Map(), actions: new Map() }
  let action
  let config = `
    version: 2
    mergeable:
      - when: pull_request.*
        validate:
          - do: title
            must_exclude:
              regex: wip|work in progress|do not merge
              message: 'a custom message'
          - do: label
            must_exclude:
              regex: wip|work in progress
  `
  let configWithMultiple = config + `
      - when: pull_request_review.submitted
        validate:
          - do: milestone
            no_empty:
              enabled: true
  `

  beforeEach(() => {
    context = Helper.mockContext('title')
    Helper.mockConfigWithContext(context, config)

    action = new Action()
    action.processBeforeValidate = jest.fn()
    action.processAfterValidate = jest.fn()
    action.supportedEvents = ['pull_request.opened', 'pull_request.edited', 'pull_request_review.submitted']
    registry.actions.set('checks', action)
  })

  test('when event is in configuration', async () => {
    context.event = 'pull_request'
    context.payload.action = 'opened'
    await executor(context, registry)
    expect(action.processBeforeValidate.mock.calls.length).toBe(1)
    expect(action.processAfterValidate.mock.calls.length).toBe(1)
  })

  test('when event is not in configuration', async () => {
    context.event = 'pull_request_review'
    context.payload.action = 'submitted'
    await executor(context, registry)
    expect(action.processBeforeValidate.mock.calls.length).toBe(0)
    expect(action.processAfterValidate.mock.calls.length).toBe(0)
  })

  test('when event is in configuration with multiple whens', async () => {
    Helper.mockConfigWithContext(context, configWithMultiple)
    context.event = 'pull_request_review'
    context.payload.action = 'submitted'
    await executor(context, registry)
    expect(action.processBeforeValidate.mock.calls.length).toBe(1)
    expect(action.processAfterValidate.mock.calls.length).toBe(1)
  })

  test('when event is NOT in configuration with multiple whens', async () => {
    Helper.mockConfigWithContext(context, configWithMultiple)
    context.event = 'pull_request_review'
    context.payload.action = 'commented'
    await executor(context, registry)
    expect(action.processBeforeValidate.mock.calls.length).toBe(0)
    expect(action.processAfterValidate.mock.calls.length).toBe(0)
  })
})

describe('#executor', () => {
  test('Bad YML', async () => {
    let context = Helper.mockContext('title')
    Helper.mockConfigWithContext(context, `
      version: 2
      mergeable:
    when: pull_request.*
    `)

    context.event = 'pull_request'
    context.payload.action = 'opened'
    context.github.checks.create = jest.fn()
    context.github.checks.update = jest.fn()

    await executor(context, { validators: new Map(), actions: new Map() })
    expect(context.github.checks.update.mock.calls.length).toBe(0)
    expect(context.github.checks.create.mock.calls.length).toBe(1)

    const theCall = context.github.checks.create.mock.calls[0][0]
    expect(theCall.status).toBe('completed')
    expect(theCall.conclusion).toBe('cancelled')
  })

  test('One When', async () => {
    let context = Helper.mockContext('title')
    Helper.mockConfigWithContext(context, `
      version: 2
      mergeable:
        - when: pull_request.*
          validate:
            - do: title
              must_include:
                regex: wip|work in progress|do not merge
                message: 'a custom message'
            - do: label
              must_include:
                regex: wip|work in progress
          pass:
            - do: checks
              status: success
              payload:
                title: Success!!
                summary: You are ready to merge
          fail:
            - do: checks
              status: success
              payload:
                title: Success!!
                summary: You are ready to merge
    `)

    let registry = { validators: new Map(), actions: new Map() }
    context.event = 'pull_request'
    context.payload.action = 'opened'
    await executor(context, registry)
    // test that the registry will register dynamicly.
    expect(registry.validators.get('title')).toBeDefined()
    expect(registry.validators.get('label')).toBeDefined()

    let title = {
      processValidate: jest.fn().mockReturnValue({status: 'pass'}),
      isEventSupported: jest.fn().mockReturnValue(true)
    }
    let label = {
      processValidate: jest.fn().mockReturnValue({status: 'pass'}),
      isEventSupported: jest.fn().mockReturnValue(true)
    }
    registry.validators.set('title', title)
    registry.validators.set('label', label)

    let checks = {
      processBeforeValidate: jest.fn(),
      processAfterValidate: jest.fn(),
      isEventSupported: jest.fn().mockReturnValue(false)
    }
    registry.actions.set('checks', checks)

    await executor(context, registry)

    expect(title.processValidate).toHaveBeenCalledTimes(1)
    expect(label.processValidate).toHaveBeenCalledTimes(1)
    expect(checks.processBeforeValidate).toHaveBeenCalledTimes(0)
    expect(checks.processAfterValidate).toHaveBeenCalledTimes(0)
  })

  test('Comma seperated events', async () => {
    let context = Helper.mockContext('title')
    Helper.mockConfigWithContext(context, `
      version: 2
      mergeable:
        - when: pull_request.opened, issues.opened
          validate:
            - do: title
              must_include:
                regex: wip|work in progress|do not merge
            - do: issueOnly
          pass:
            - do: checks
              status: success
              payload:
                title: Success!!
                summary: You are ready to merge
          fail:
            - do: checks
              status: success
              payload:
                title: Success!!
                summary: You are ready to merge
    `)

    let registry = { validators: new Map(), actions: new Map() }
    let title = {
      processValidate: jest.fn(value => Promise.resolve({status: 'pass'})),
      isEventSupported: jest.fn().mockReturnValue(true)
    }
    registry.validators.set('title', title)
    let issueOnly = {
      processValidate: jest.fn(value => Promise.resolve({status: 'pass'})),
      isEventSupported: jest.fn(event => { return (event === 'issues.opened') })
    }
    registry.validators.set('issueOnly', issueOnly)

    let checks = {
      processBeforeValidate: jest.fn(),
      processAfterValidate: jest.fn(),
      isEventSupported: jest.fn(event => { return (event === 'pull_request.opened') })
    }
    registry.actions.set('checks', checks)

    context.event = 'pull_request'
    context.payload.action = 'opened'
    await executor(context, registry)
    expect(title.processValidate).toHaveBeenCalledTimes(1)
    expect(title.isEventSupported).toHaveBeenCalledTimes(1)
    expect(issueOnly.processValidate).toHaveBeenCalledTimes(0)
    expect(issueOnly.isEventSupported).toHaveBeenCalledTimes(1)
    expect(checks.processBeforeValidate).toHaveBeenCalledTimes(1)
    expect(checks.processAfterValidate).toHaveBeenCalledTimes(1)

    context.event = 'issues'
    context.payload.action = 'opened'
    await executor(context, registry)
    expect(title.processValidate).toHaveBeenCalledTimes(2)
    expect(title.isEventSupported).toHaveBeenCalledTimes(2)
    expect(issueOnly.processValidate).toHaveBeenCalledTimes(1)
    expect(issueOnly.isEventSupported).toHaveBeenCalledTimes(2)
    expect(checks.processBeforeValidate).toHaveBeenCalledTimes(1)
    expect(checks.processAfterValidate).toHaveBeenCalledTimes(1)
  })

  test('Multiple Whens', async () => {
    let context = Helper.mockContext('title')
    Helper.mockConfigWithContext(context, `
      version: 2
      mergeable:
        - when: pull_request.opened
          validate:
            - do: title
              must_exclude:
                regex: 'wip'
          pass:
            - do: checks
              status: success
              payload:
                title: Success!!
                summary: You are ready to merge
          fail:
            - do: checks
              status: success
              payload:
                title: Success!!
                summary: You are ready to merge
        - when: issues.opened
          validate:
            - do: label
              must_exclude:
                regex: 'wip'
            - do: title
          pass:
            - do: checks
              status: success
              payload:
                title: Success!!
                summary: You are ready to merge
          fail:
            - do: checks
              status: success
              payload:
                title: Success!!
                summary: You are ready to merge
    `)

    let registry = { validators: new Map(), actions: new Map() }
    let title = {
      processValidate: jest.fn(value => Promise.resolve({status: 'pass'})),
      isEventSupported: jest.fn().mockReturnValue(true)
    }
    registry.validators.set('title', title)
    let label = {
      processValidate: jest.fn(value => Promise.resolve({status: 'pass'})),
      isEventSupported: jest.fn().mockReturnValue(true)
    }
    registry.validators.set('label', label)
    let checks = {
      processBeforeValidate: jest.fn(),
      processAfterValidate: jest.fn(),
      isEventSupported: jest.fn().mockReturnValue(true)
    }
    registry.actions.set('checks', checks)

    context.event = 'pull_request'
    context.payload.action = 'opened'
    await executor(context, registry)
    expect(title.processValidate).toHaveBeenCalledTimes(1)
    expect(label.processValidate).toHaveBeenCalledTimes(0)
    expect(checks.processBeforeValidate).toHaveBeenCalledTimes(1)
    expect(checks.processAfterValidate).toHaveBeenCalledTimes(1)

    context.event = 'issues'
    await executor(context, registry)
    expect(title.processValidate).toHaveBeenCalledTimes(2)
    expect(label.processValidate).toHaveBeenCalledTimes(1)
    expect(checks.processBeforeValidate).toHaveBeenCalledTimes(2)
    expect(checks.processAfterValidate).toHaveBeenCalledTimes(2)
  })

  test('isEventInContext is working only for correct event', async () => {
    let context = Helper.mockContext('title')
    Helper.mockConfigWithContext(context, `
      version: 2
      mergeable:
        - when: pull_request.opened
          validate:
            - do: title
              must_exclude:
                regex: 'wip'
          pass:
            - do: checks
              status: success
              payload:
                title: Success!!
                summary: You are ready to merge
          fail:
            - do: checks
              status: success
              payload:
                title: Success!!
                summary: You are ready to merge
        - when: issues.opened
          validate:
            - do: label
              must_exclude:
                regex: 'wip'
            - do: title
          pass:
            - do: checks
              status: success
              payload:
                title: Success!!
                summary: You are ready to merge
          fail:
            - do: checks
              status: success
              payload:
                title: Success!!
                summary: You are ready to merge
    `)

    let registry = { validators: new Map(), actions: new Map() }
    let title = {
      processValidate: jest.fn(value => Promise.resolve({status: 'pass'})),
      isEventSupported: jest.fn().mockReturnValue(true)
    }
    registry.validators.set('title', title)
    let label = {
      processValidate: jest.fn(value => Promise.resolve({status: 'pass'})),
      isEventSupported: jest.fn().mockReturnValue(true)
    }
    registry.validators.set('label', label)
    let checks = {
      processBeforeValidate: jest.fn(),
      processAfterValidate: jest.fn(),
      isEventSupported: jest.fn().mockReturnValue(true)
    }
    registry.actions.set('checks', checks)

    context.event = 'pull_request_review'
    context.payload.action = 'opened'
    await executor(context, registry)
    expect(title.processValidate).toHaveBeenCalledTimes(0)
    expect(label.processValidate).toHaveBeenCalledTimes(0)
    expect(checks.processBeforeValidate).toHaveBeenCalledTimes(0)
    expect(checks.processAfterValidate).toHaveBeenCalledTimes(0)

    context.event = 'pull_request'
    await executor(context, registry)
    expect(title.processValidate).toHaveBeenCalledTimes(1)
    expect(label.processValidate).toHaveBeenCalledTimes(0)
    expect(checks.processBeforeValidate).toHaveBeenCalledTimes(1)
    expect(checks.processAfterValidate).toHaveBeenCalledTimes(1)
  })

  test('Error handling', async() => {
    let registry = { validators: new Map(), actions: new Map() }
    let errorValidator = {
      processValidate: jest.fn(value => Promise.reject(new Error('Uncaught error'))),
      isEventSupported: jest.fn().mockReturnValue(true)
    }
    let passAction = {
      processBeforeValidate: jest.fn(),
      processAfterValidate: jest.fn(),
      isEventSupported: jest.fn().mockReturnValue(true)
    }
    let errorAction = {
      processBeforeValidate: jest.fn(),
      processAfterValidate: jest.fn(),
      isEventSupported: jest.fn().mockReturnValue(true)
    }
    registry.validators.set('error', errorValidator)
    registry.actions.set('pass_action', passAction)
    registry.actions.set('error_action', errorAction)

    let context = Helper.mockContext('error')
    Helper.mockConfigWithContext(context, `
      version: 2
      mergeable:
        - when: pull_request.opened
          validate:
            - do: error
          pass:
            - do: pass_action
          error:
            - do: error_action
    `)
    context.event = 'pull_request'
    context.payload.action = 'opened'
    await executor(context, registry)

    expect(errorAction.processBeforeValidate).toHaveBeenCalledTimes(1)
    expect(errorAction.processAfterValidate).toHaveBeenCalledTimes(1)
    expect(passAction.processBeforeValidate).toHaveBeenCalledTimes(1)
    expect(passAction.processAfterValidate).toHaveBeenCalledTimes(0)
  })
})
