/**
 * Provider API responses for the observability tests, copied from the real read-only responses of the
 * production accounts (2026-10-30), trimmed to the fields the service reads. Personal data removed (emails,
 * avatars, usernames); IDs kept because they are not secret and also live in render.yaml.
 *
 * Exception: the GitHub billing usage report is built from the documented schema
 * (GET /users/{username}/settings/billing/usage), since no token with the "Plan" permission was available.
 */

// ------------------------------------------------------------------------------------------------ Neon

export const neonProject = {
  project: {
    data_storage_bytes_hour: 0,
    data_transfer_bytes: 178364830,
    written_data_bytes: 0,
    compute_time_seconds: 121240,
    active_time_seconds: 476656,
    cpu_used_sec: 0,
    id: 'spring-boat-14626479',
    platform_id: 'aws',
    region_id: 'aws-us-east-2',
    name: 'WhatsAI',
    default_endpoint_settings: {
      autoscaling_limit_min_cu: 0.25,
      autoscaling_limit_max_cu: 2,
      suspend_timeout_seconds: 0,
    },
    pg_version: 16,
    branch_logical_size_limit: 1024,
    branch_logical_size_limit_bytes: 1073741824,
    history_retention_seconds: 21600,
    created_at: '2026-10-22T21:27:29Z',
    synthetic_storage_size: 0,
    consumption_period_start: '2026-10-22T21:23:11Z',
    consumption_period_end: '2026-11-01T00:00:00Z',
    owner_id: 'org-soft-mouse-21767293',
    owner: { name: 'devconnecting1', branches_limit: 10, subscription_type: 'free_v3' },
    compute_last_active_at: '2026-10-30T12:26:11Z',
    org_id: 'org-soft-mouse-21767293',
  },
};

export const neonBranches = {
  branches: [
    {
      id: 'br-wandering-smoke-b5btv2mw',
      name: 'production',
      current_state: 'ready',
      logical_size: 40484864,
      primary: true,
      default: true,
      compute_time_seconds: 121084,
      active_time_seconds: 476040,
      data_transfer_bytes: 178364830,
    },
    {
      id: 'br-fancy-meadow-b55td1bj',
      parent_id: 'br-wandering-smoke-b5btv2mw',
      name: 'preview/main',
      current_state: 'ready',
      logical_size: 34660352,
      primary: false,
      default: false,
      compute_time_seconds: 77,
      active_time_seconds: 304,
    },
    {
      id: 'br-curly-grass-b5tj4w3o',
      parent_id: 'br-wandering-smoke-b5btv2mw',
      name: 'vercel-dev',
      current_state: 'ready',
      logical_size: 34660352,
      primary: false,
      default: false,
      compute_time_seconds: 79,
      active_time_seconds: 312,
    },
  ],
};

export const neonEndpoints = {
  endpoints: [
    {
      id: 'ep-example-00000000',
      branch_id: 'br-wandering-smoke-b5btv2mw',
      type: 'read_write',
      current_state: 'active',
      autoscaling_limit_min_cu: 0.25,
      autoscaling_limit_max_cu: 2,
    },
  ],
};

export const neonOrganization = {
  id: 'org-soft-mouse-21767293',
  name: 'devconnecting1',
  plan: 'free',
};

// ---------------------------------------------------------------------------------------------- Render

export const renderService = {
  autoDeploy: 'yes',
  branch: 'main',
  dashboardUrl: 'https://dashboard.render.com/web/srv-dbd9qqi9lscs73aoe85g',
  id: 'srv-dbd9qqi9lscs73aoe85g',
  name: 'evolution-api',
  ownerId: 'tea-dbd7a58m7kps73c2cr5g',
  serviceDetails: {
    env: 'docker',
    healthCheckPath: '/',
    numInstances: 1,
    plan: 'free',
    region: 'ohio',
    runtime: 'docker',
    url: 'https://evolution-api-x93o.onrender.com',
  },
  slug: 'evolution-api-x93o',
  suspended: 'not_suspended',
  suspenders: [],
  type: 'web_service',
};

export const renderKeyValue = {
  id: 'red-dbd9qp29lscs73aoe2s0',
  name: 'evolution-redis',
  options: { maxmemoryPolicy: 'allkeys_lru', persistenceMode: 'off' },
  plan: 'free',
  region: 'ohio',
  status: 'available',
  version: '8.1.10',
};

/** GET /services/{id}/deploys returns `[{ deploy, cursor }]`. */
export const renderDeploys = [
  {
    cursor: 'aKNASaj6JF9mcnJtOGhxczczYW10Mzdn',
    deploy: {
      commit: { createdAt: '2026-10-30T09:38:21Z', id: 'e4e2cedcb53c3e4b839e48d92556706a1f723fa1' },
      createdAt: '2026-10-30T09:38:23.885488Z',
      finishedAt: '2026-10-30T09:41:06.035835Z',
      id: 'dep-dbi6b3rncjis73akm2ng',
      status: 'live',
      trigger: 'new_commit',
    },
  },
];

const series = (unit: string, values: [string, number][], instance = true) => [
  {
    labels: [
      ...(instance ? [{ field: 'instance', value: 'srv-dbd9qqi9lscs73aoe85g-8hvrp' }] : []),
      { field: 'service', value: 'srv-dbd9qqi9lscs73aoe85g' },
      { field: 'resource', value: 'srv-dbd9qqi9lscs73aoe85g' },
    ],
    unit,
    values: values.map(([timestamp, value]) => ({ timestamp, value })),
  },
];

export const renderMetrics = {
  cpu: series('cpu', [
    ['2026-10-30T12:21:13.277Z', 0.001933335],
    ['2026-10-30T12:31:13.277Z', 0.0021031634],
  ]),
  cpuLimit: series('cpu', [
    ['2026-10-30T12:21:13.516Z', 0.15],
    ['2026-10-30T12:31:13.516Z', 0.15],
  ]),
  memory: series('bytes', [
    ['2026-10-30T12:21:13.399Z', 233218050],
    ['2026-10-30T12:31:13.399Z', 233930750],
  ]),
  memoryLimit: series('bytes', [
    ['2026-10-30T12:21:13.632Z', 536870900],
    ['2026-10-30T12:31:13.632Z', 536870900],
  ]),
  /** resolutionSeconds=3600 over the month: two instances (a deploy) overlapping at 01:00. */
  cpuHourly: [
    ...series('cpu', [
      ['2026-10-29T00:00:00Z', 0.0026996103],
      ['2026-10-29T01:00:00Z', 0.0026926494],
    ]),
    ...series('cpu', [
      ['2026-10-29T01:00:00Z', 0.0034942268],
      ['2026-10-29T02:00:00Z', 0.0029449358],
    ]),
  ],
  bandwidth: series(
    'mb',
    [
      ['2026-10-29T00:00:00Z', 1.5406828],
      ['2026-10-29T01:00:00Z', 2.459055],
    ],
    false,
  ),
  keyValueMemory: [
    {
      labels: [{ field: 'resource', value: 'red-dbd9qp29lscs73aoe2s0' }],
      unit: 'bytes',
      values: [{ timestamp: '2026-10-30T12:34:09.893Z', value: 6467584 }],
    },
  ],
  keyValueMemoryLimit: [
    {
      labels: [{ field: 'resource', value: 'red-dbd9qp29lscs73aoe2s0' }],
      unit: 'bytes',
      values: [{ timestamp: '2026-10-30T12:34:09.998Z', value: 26214400 }],
    },
  ],
  /** instance-count came back empty for the Free web service. */
  instanceCount: [],
};

// ---------------------------------------------------------------------------------------------- Vercel

export const vercelTeam = {
  id: 'team_L4ydLNVlb1XnoQd49WIvXRfw',
  slug: 'matheus-projects-309a1b5f',
  name: "Matheus' projects",
  billing: { plan: 'hobby' },
};

export const vercelProject = {
  id: 'prj_1qlhQq1PuLn20KRs2FK0fsD0GIvU',
  name: 'whatsai-manager',
  accountId: 'team_L4ydLNVlb1XnoQd49WIvXRfw',
  createdAt: 1792709939890,
  targets: {
    production: {
      id: 'dpl_8mgPmZyo4hiUxEA7fdTUy1HEkhaQ',
      alias: [
        'whatsaibr.vercel.app',
        'whatsai-manager-six.vercel.app',
        'whatsai-manager-matheus-projects-309a1b5f.vercel.app',
      ],
      readyState: 'READY',
    },
  },
};

/** GET /v6/deployments (newest first). `buildingAt`/`ready` are epoch ms like `created`. */
export const vercelDeployments = {
  pagination: { count: 3, next: 1792737357570, prev: 1793353139860 },
  deployments: [
    {
      uid: 'dpl_8mgPmZyo4hiUxEA7fdTUy1HEkhaQ',
      name: 'whatsai-manager',
      url: 'whatsai-manager-g1lu5qlvc-matheus-projects-309a1b5f.vercel.app',
      created: 1793353139860,
      buildingAt: 1793353141000,
      ready: 1793353171000,
      state: 'READY',
      readyState: 'READY',
      target: 'production',
      meta: { githubCommitRef: 'main', githubCommitSha: 'e4e2cedcb53c3e4b839e48d92556706a1f723fa1' },
    },
    {
      uid: 'dpl_HKfiKTM5Mg3YQM9pVmbe7mhZrg5t',
      name: 'whatsai-manager',
      url: 'whatsai-manager-jqhj6gohw-matheus-projects-309a1b5f.vercel.app',
      created: 1793335461624,
      buildingAt: 1793335462000,
      ready: 1793335492000,
      state: 'READY',
      readyState: 'READY',
      target: 'production',
      meta: { githubCommitRef: 'main', githubCommitSha: '0de71b120e9ee940bada324d316e0666aa322f9b' },
    },
    {
      uid: 'dpl_BzYnyjBcsBf3oC92853JVBxVuaUj',
      name: 'whatsai-manager',
      url: 'whatsai-manager-kl3y7xxcp-matheus-projects-309a1b5f.vercel.app',
      created: 1792737357570,
      buildingAt: 1792737358000,
      ready: 1792737418000,
      state: 'READY',
      readyState: 'READY',
      target: 'production',
      meta: { githubCommitRef: 'main', githubCommitSha: 'b249b9cf3d70f3135006985c540ea0a055fdc5ee' },
    },
  ],
};

// ---------------------------------------------------------------------------------------------- GitHub

export const githubRepo = {
  full_name: 'devconnecting1/evolution-api-render',
  private: true,
  visibility: 'private',
  default_branch: 'main',
  owner: { login: 'devconnecting1', type: 'User' },
};

export const githubRuns = {
  total_count: 64,
  workflow_runs: [
    {
      id: 41034895705,
      name: 'Deploy Manager',
      event: 'push',
      status: 'completed',
      conclusion: 'success',
      head_branch: 'main',
      created_at: '2026-10-30T09:38:24Z',
    },
    {
      id: 41034895694,
      name: 'Security',
      event: 'push',
      status: 'completed',
      conclusion: 'success',
      head_branch: 'main',
      created_at: '2026-10-30T09:38:24Z',
    },
    {
      id: 41034000001,
      name: 'CI',
      event: 'pull_request',
      status: 'completed',
      conclusion: 'failure',
      head_branch: 'feat/x',
      created_at: '2026-10-29T10:00:00Z',
    },
  ],
};

export const githubBillingUsage = {
  usageItems: [
    {
      date: '2026-10-29T00:00:00Z',
      product: 'actions',
      sku: 'actions_linux',
      quantity: 120,
      unitType: 'Minutes',
      pricePerUnit: 0.008,
      grossAmount: 0.96,
      discountAmount: 0.96,
      netAmount: 0,
      repositoryName: 'devconnecting1/evolution-api-render',
    },
    {
      date: '2026-10-30T00:00:00Z',
      product: 'actions',
      sku: 'actions_linux',
      quantity: 35.5,
      unitType: 'Minutes',
      pricePerUnit: 0.008,
      grossAmount: 0.284,
      discountAmount: 0.284,
      netAmount: 0,
      repositoryName: 'devconnecting1/evolution-api-render',
    },
    {
      date: '2026-10-30T00:00:00Z',
      product: 'actions',
      sku: 'actions_storage',
      quantity: 0.01,
      unitType: 'GigabyteHours',
      pricePerUnit: 0.00033,
      grossAmount: 0,
      discountAmount: 0,
      netAmount: 0,
    },
    {
      date: '2026-10-30T00:00:00Z',
      product: 'packages',
      sku: 'packages_storage',
      quantity: 1,
      unitType: 'GigabyteHours',
      pricePerUnit: 0.008,
      grossAmount: 0,
      discountAmount: 0,
      netAmount: 0,
    },
  ],
};
