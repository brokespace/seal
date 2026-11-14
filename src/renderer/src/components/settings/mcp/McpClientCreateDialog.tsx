import { useId, useState } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import {
  SEAL_MCP_APPROVAL_POLICIES,
  SEAL_MCP_SCOPES,
  isSealMcpApprovalPolicy,
  type SealMcpApprovalPolicy,
  type SealMcpClientCreateArgs,
  type SealMcpMachine,
  type SealMcpScope
} from '../../../../../shared/seal-mcp/seal-mcp-types'
import {
  sealMcpApprovalPolicyLabel,
  sealMcpScopeDescription,
  sealMcpScopeLabel
} from '@/components/seal-mcp/seal-mcp-labels'
import { Button } from '../../ui/button'
import { Checkbox } from '../../ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../../ui/dialog'
import { Input } from '../../ui/input'
import { Label } from '../../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select'
import { Switch } from '../../ui/switch'
import { SettingsSegmentedControl } from '../form-controls/SettingsFormControls'
import { McpMachineChecklist } from './McpMachineChecklist'

const DEFAULT_CALLS_PER_MINUTE = 120
const MAX_CALLS_PER_MINUTE = 6000
const MAX_NAME_LENGTH = 80

type McpClientCreateDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Null while the server's machine list is still being read. */
  machines: readonly SealMcpMachine[] | null
  /** Resolves true once the client exists; the dialog then closes. */
  onCreate: (args: SealMcpClientCreateArgs) => Promise<boolean>
}

function toggled<T>(list: readonly T[], item: T, on: boolean): T[] {
  return on ? [...list.filter((entry) => entry !== item), item] : list.filter((e) => e !== item)
}

function CheckRow({
  checked,
  onChange,
  label,
  description
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  description?: string
}): React.JSX.Element {
  const id = useId()
  return (
    <div className="flex items-start gap-2.5">
      <Checkbox
        id={id}
        className="mt-0.5"
        checked={checked}
        onCheckedChange={(next) => onChange(next === true)}
      />
      <div className="min-w-0 space-y-0.5">
        <Label htmlFor={id}>{label}</Label>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
    </div>
  )
}

function McpClientCreateForm({
  machines,
  onCreate,
  onClose
}: Pick<McpClientCreateDialogProps, 'machines' | 'onCreate'> & {
  onClose: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<SealMcpScope[]>(['read'])
  const [machineMode, setMachineMode] = useState<'all' | 'some'>('all')
  const [machineIds, setMachineIds] = useState<string[]>([])
  const [approval, setApproval] = useState<SealMcpApprovalPolicy>('destructive')
  const [allowRelay, setAllowRelay] = useState(false)
  const [rate, setRate] = useState(String(DEFAULT_CALLS_PER_MINUTE))
  const [creating, setCreating] = useState(false)
  const nameId = useId()
  const rateId = useId()
  const relayId = useId()
  const approvalLabelId = useId()

  const callsPerMinute = Number(rate)
  const rateValid =
    Number.isInteger(callsPerMinute) &&
    callsPerMinute >= 1 &&
    callsPerMinute <= MAX_CALLS_PER_MINUTE
  const valid =
    name.trim().length > 0 &&
    scopes.length > 0 &&
    rateValid &&
    (machineMode === 'all' || machineIds.length > 0)

  const create = async (): Promise<void> => {
    if (!valid || creating) {
      return
    }
    setCreating(true)
    const created = await onCreate({
      name: name.trim(),
      // The server's own order, whatever order the boxes were ticked in.
      scopes: SEAL_MCP_SCOPES.filter((scope) => scopes.includes(scope)),
      machines: machineMode === 'all' ? null : machineIds,
      approval,
      allowRelay,
      callsPerMinute
    })
    setCreating(false)
    if (created) {
      onClose()
    }
  }

  return (
    <form
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault()
        void create()
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor={nameId}>{t('seal.mcp.create.name', 'Name')}</Label>
        <Input
          id={nameId}
          value={name}
          maxLength={MAX_NAME_LENGTH}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('seal.mcp.create.namePlaceholder', 'Claude Code on my laptop')}
        />
      </div>

      <fieldset className="grid gap-2.5">
        <legend className="mb-2.5 text-sm font-medium">
          {t('seal.mcp.create.scopes', 'What it may do')}
        </legend>
        {SEAL_MCP_SCOPES.map((scope) => (
          <CheckRow
            key={scope}
            checked={scopes.includes(scope)}
            onChange={(on) => setScopes((current) => toggled(current, scope, on))}
            label={sealMcpScopeLabel(scope, t)}
            description={sealMcpScopeDescription(scope, t)}
          />
        ))}
        {scopes.length === 0 ? (
          <p className="text-xs text-destructive">
            {t('seal.mcp.create.scopesRequired', 'Choose at least one.')}
          </p>
        ) : null}
      </fieldset>

      <fieldset className="grid gap-2.5">
        <legend className="mb-2.5 text-sm font-medium">
          {t('seal.mcp.create.machines', 'Machines it may act on')}
        </legend>
        <div>
          <SettingsSegmentedControl
            size="sm"
            value={machineMode}
            onChange={setMachineMode}
            options={[
              { value: 'all', label: t('seal.mcp.create.machinesAll', 'All machines') },
              { value: 'some', label: t('seal.mcp.create.machinesSome', 'Only these') }
            ]}
            ariaLabel={t('seal.mcp.create.machines', 'Machines it may act on')}
          />
        </div>
        {machineMode === 'all' ? (
          <p className="text-xs text-muted-foreground">
            {t(
              'seal.mcp.create.machinesAllDescription',
              'Includes machines added to this server later.'
            )}
          </p>
        ) : machines === null ? (
          <p className="text-xs text-muted-foreground">
            {t('seal.mcp.create.machinesLoading', 'Reading machines…')}
          </p>
        ) : machines.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t('seal.mcp.create.machinesNone', 'This server lists no machines.')}
          </p>
        ) : (
          <McpMachineChecklist
            machines={machines}
            selectedIds={machineIds}
            onToggle={(id, on) => setMachineIds((current) => toggled(current, id, on))}
          />
        )}
      </fieldset>

      <div className="grid gap-1.5">
        <Label id={approvalLabelId}>
          {t('seal.mcp.create.approval', 'Approval in the Seal app')}
        </Label>
        <Select
          value={approval}
          onValueChange={(next) => {
            if (isSealMcpApprovalPolicy(next)) {
              setApproval(next)
            }
          }}
        >
          <SelectTrigger size="sm" className="w-full" aria-labelledby={approvalLabelId}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SEAL_MCP_APPROVAL_POLICIES.map((policy) => (
              <SelectItem key={policy} value={policy}>
                {sealMcpApprovalPolicyLabel(policy, t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {t(
            'seal.mcp.create.approvalDescription',
            'A call that waits for approval is declined if nobody answers within two minutes.'
          )}
        </p>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-0.5">
          <Label htmlFor={relayId}>{t('seal.mcp.create.allowRelay', 'Allow through relay')}</Label>
          <p className="text-xs text-muted-foreground">
            {t(
              'seal.mcp.create.allowRelayDescription',
              'Lets this client connect over the public relay URL. The relay can read what passes through it.'
            )}
          </p>
        </div>
        <Switch id={relayId} checked={allowRelay} onCheckedChange={setAllowRelay} />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={rateId}>{t('seal.mcp.create.rate', 'Calls per minute')}</Label>
        <Input
          id={rateId}
          type="number"
          min={1}
          max={MAX_CALLS_PER_MINUTE}
          step={1}
          value={rate}
          aria-invalid={!rateValid}
          onChange={(event) => setRate(event.target.value)}
          className="w-28"
        />
        <p className="text-xs text-muted-foreground">
          {t(
            'seal.mcp.create.rateDescription',
            'Above this the client is told to slow down. 1 to 6000.'
          )}
        </p>
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('seal.mcp.create.cancel', 'Cancel')}
        </Button>
        <Button type="submit" disabled={!valid || creating}>
          {t('seal.mcp.create.submit', 'Create client')}
        </Button>
      </DialogFooter>
    </form>
  )
}

/** Names a new MCP client and what it may do; the token is shown by the dialog that follows. */
export function McpClientCreateDialog({
  open,
  onOpenChange,
  machines,
  onCreate
}: McpClientCreateDialogProps): React.JSX.Element {
  const t = useTranslate()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent scrollable className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('seal.mcp.create.title', 'Add MCP client')}</DialogTitle>
          <DialogDescription>
            {t(
              'seal.mcp.create.description',
              'Each client gets its own token. Give it only what it needs; you can revoke it at any time.'
            )}
          </DialogDescription>
        </DialogHeader>
        {/* Mounted per opening, so a cancelled draft never comes back. */}
        <McpClientCreateForm
          machines={machines}
          onCreate={onCreate}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
