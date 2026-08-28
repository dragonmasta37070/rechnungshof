export namespace Schemas {
  // <Schemas>
  export type AccountType = 'personal' | 'clearing';
  export type ClearingAccount = {
    id: number;
    group_id: number;
    type: string;
    name: string;
    description: string;
    date_info: string;
    tags: Array<string>;
    clearing_shares: Record<string, number>;
    last_changed: string;
    deleted: boolean;
  };
  export type ClearingAccountJsonExportV1 = {
    id: number;
    name: string;
    description: string;
    date_info: string;
    tags: Array<string>;
    clearing_shares: Record<string, number>;
  };
  export type CreateInvitePayload = {
    description: string;
    single_use: boolean;
    join_as_editor: boolean;
    valid_until?: (string | null) | undefined;
  };
  export type CurrencyConversionRate = { base_currency: string; rates: Record<string, number> };
  export type FileAttachment = {
    id: number;
    filename: string;
    blob_id: number | null;
    mime_type: string | null;
    host_url?: (string | null) | undefined;
    deleted: boolean;
  };
  export type FileAttachmentJsonExportV1 = { filename: string; mime_type: string; content: string };
  export type ServiceMessageType = 'info' | 'error' | 'warning' | 'success';
  export type ServiceMessage = {
    type: ServiceMessageType;
    title?: (string | null) | undefined;
    body: string;
  };
  /**
   * What a browser client needs to start the PKCE flow itself.
   *
   * Both values are public by definition: the client id travels in every
   * authorization URL, and the issuer is the provider's own discovery identity.
   * Nothing secret is exposed here — the audience/client id is not a credential,
   * which is exactly why the provider is configured as a public client.
   *
   * Serving these instead of baking them into the bundle is what keeps one built
   * artifact deployable against dev, staging and production: an Angular build is
   * static, so container env vars never reach the browser on their own.
   */
  export type OIDCFrontendConfig = { issuer: string; client_id: string };
  export type FrontendConfig = {
    messages?: (Array<ServiceMessage> | null) | undefined;
    imprint_url?: (string | null) | undefined;
    source_code_url: string;
    issue_tracker_url: string;
    oidc: OIDCFrontendConfig;
  };
  export type Group = {
    id: number;
    name: string;
    description: string;
    currency_identifier: string;
    terms: string;
    add_user_account_on_join: boolean;
    created_at: string;
    created_by: number;
    last_changed: string;
    archived: boolean;
    is_owner: boolean;
    can_write: boolean;
    owned_account_id: number | null;
  };
  export type GroupCreatePayload = {
    name: string;
    description?: string | undefined;
    add_user_account_on_join?: boolean | undefined;
    terms?: string | undefined;
    currency_identifier: string;
  };
  export type GroupInvite = {
    id: number;
    created_by: number;
    token: string | null;
    single_use: boolean;
    join_as_editor: boolean;
    description: string;
    valid_until: string | null;
  };
  export type GroupMetadataExportV1 = {
    name: string;
    description: string;
    currency_identifier: string;
    terms: string;
    add_user_account_on_join: boolean;
  };
  export type PersonalAccountJsonExportV1 = { id: number; name: string; description: string };
  export type TransactionType = 'mimo' | 'purchase' | 'transfer';
  export type SplitMode = 'shares' | 'absolute' | 'percent';
  export type TransactionPositionJsonExportV1 = {
    id: number;
    name: string;
    price: number;
    communist_shares: number;
    usages: Record<string, number>;
  };
  export type TransactionJsonExportV1 = {
    id: number;
    type: TransactionType;
    name: string;
    description: string;
    value: number;
    currency_identifier: string;
    currency_conversion_rate: number;
    billed_at: string;
    tags: Array<string>;
    split_mode?: SplitMode | undefined;
    creditor_shares: Record<string, number>;
    debitor_shares: Record<string, number>;
    positions: Array<TransactionPositionJsonExportV1>;
    files: Array<FileAttachmentJsonExportV1>;
  };
  export type GroupJsonExportV1 = {
    version?: number | undefined;
    metadata: GroupMetadataExportV1;
    personal_accounts: Array<PersonalAccountJsonExportV1>;
    events: Array<ClearingAccountJsonExportV1>;
    transactions: Array<TransactionJsonExportV1>;
  };
  export type GroupLog = {
    id: number;
    user_id: number;
    logged_at: string;
    type: string;
    message: string;
    affected: number | null;
  };
  export type GroupMember = {
    user_id: number;
    username: string;
    is_owner: boolean;
    can_write: boolean;
    description: string;
    joined_at: string;
    invited_by: number | null;
    owned_account_id: number | null;
  };
  export type GroupMessage = { message: string };
  export type GroupPreview = {
    id: number;
    is_already_member: boolean;
    name: string;
    description: string;
    currency_identifier: string;
    terms: string;
    created_at: string;
    invite_single_use: boolean;
    invite_valid_until: string | null;
    invite_description: string;
  };
  export type GroupUpdatePayload = {
    name: string;
    description?: string | undefined;
    add_user_account_on_join?: boolean | undefined;
    terms?: string | undefined;
  };
  export type ValidationError = {
    loc: Array<string | number>;
    msg: string;
    type: string;
    input?: unknown | undefined;
    ctx?: Record<string, unknown> | undefined;
  };
  export type HTTPValidationError = Partial<{ detail: Array<ValidationError> }>;
  export type ImportGroupPayload = { group_json: string };
  export type ImportGroupResponse = { group_id: number };
  export type NewAccount = {
    type: AccountType;
    name: string;
    description?: string | undefined;
    date_info?: (string | null) | undefined;
    deleted?: boolean | undefined;
    tags?: Array<string> | undefined;
    clearing_shares?: Record<string, number> | undefined;
  };
  export type NewFile = { filename: string; mime_type: string; content: string };
  export type NewTransactionPosition = {
    name: string;
    price: number;
    communist_shares: number;
    usages: Record<string, number>;
  };
  export type NewTransaction = {
    type: TransactionType;
    name: string;
    description: string;
    value: number;
    currency_identifier: string;
    currency_conversion_rate: number;
    billed_at: string;
    tags?: Array<string> | undefined;
    creditor_shares: Record<string, number>;
    debitor_shares: Record<string, number>;
    split_mode: SplitMode;
    new_files?: Array<NewFile> | undefined;
    new_positions?: Array<NewTransactionPosition> | undefined;
  };
  export type PersonalAccount = {
    id: number;
    group_id: number;
    type: string;
    name: string;
    description: string;
    deleted: boolean;
    last_changed: string;
  };
  export type PreviewGroupPayload = { invite_token: string };
  export type TransactionPosition = {
    name: string;
    price: number;
    communist_shares: number;
    usages: Record<string, number>;
    id: number;
    deleted: boolean;
  };
  export type Transaction = {
    id: number;
    group_id: number;
    type: TransactionType;
    name: string;
    description: string;
    value: number;
    currency_identifier: string;
    currency_conversion_rate: number;
    billed_at: string;
    tags: Array<string>;
    deleted: boolean;
    creditor_shares: Record<string, number>;
    debitor_shares: Record<string, number>;
    split_mode: SplitMode;
    last_changed: string;
    positions: Array<TransactionPosition>;
    files: Array<FileAttachment>;
  };
  export type TransactionHistory = { revision_id: number; changed_by: number; changed_at: string };
  export type UpdateFile = { id: number; filename: string; deleted: boolean };
  export type UpdateGroupMemberOwnedAccountPayload = { owned_account_id: number | null };
  export type UpdateGroupMemberPermissionsPayload = { can_write: boolean; is_owner: boolean };
  export type UpdatePositionsPayload = { positions: Array<TransactionPosition> };
  export type UpdateTransaction = {
    type: TransactionType;
    name: string;
    description: string;
    value: number;
    currency_identifier: string;
    currency_conversion_rate: number;
    billed_at: string;
    tags?: Array<string> | undefined;
    creditor_shares: Record<string, number>;
    debitor_shares: Record<string, number>;
    split_mode: SplitMode;
    new_files?: Array<NewFile> | undefined;
    new_positions?: Array<NewTransactionPosition> | undefined;
    changed_files?: Array<UpdateFile> | undefined;
    changed_positions?: Array<TransactionPosition> | undefined;
  };
  export type User = {
    id: number;
    username: string;
    email: string;
    registered_at: string;
    deleted: boolean;
    pending: boolean;
    is_guest_user: boolean;
    oidc_subject?: (string | null) | undefined;
  };
  export type VersionResponse = {
    version: string;
    major_version: number;
    minor_version: number;
    patch_version: number;
  };

  // </Schemas>
}
