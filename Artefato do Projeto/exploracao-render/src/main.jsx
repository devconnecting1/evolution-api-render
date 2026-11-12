import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Alert,
  Badge,
  Button,
  Card,
  MetricCard,
  ProgressBar,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  ThemeProvider,
  ThemeToggle,
  ToastContainer,
} from "render-dds";
import {
  IoAlertCircleOutline,
  IoArrowBackOutline,
  IoArrowDownOutline,
  IoArrowForwardOutline,
  IoArrowUpOutline,
  IoAttachOutline,
  IoBriefcaseOutline,
  IoCalendarOutline,
  IoCallOutline,
  IoCardOutline,
  IoChatbubblesOutline,
  IoCheckmarkCircleOutline,
  IoChevronDownOutline,
  IoChevronForwardOutline,
  IoCloseOutline,
  IoDocumentTextOutline,
  IoDownloadOutline,
  IoEllipsisHorizontal,
  IoFilterOutline,
  IoGridOutline,
  IoHardwareChipOutline,
  IoHeadsetOutline,
  IoHourglassOutline,
  IoLocationOutline,
  IoLogOutOutline,
  IoMailOutline,
  IoMenuOutline,
  IoNotificationsOutline,
  IoPaperPlaneOutline,
  IoPeopleOutline,
  IoPersonAddOutline,
  IoPulseOutline,
  IoRefreshOutline,
  IoScaleOutline,
  IoSearchOutline,
  IoShieldCheckmarkOutline,
  IoSparklesOutline,
  IoStatsChartOutline,
  IoStorefrontOutline,
  IoTimeOutline,
  IoWarningOutline,
} from "react-icons/io5";
import "render-dds/styles";
import "./styles.css";

const THEME_KEY = "whatsai-dds-exploracao";

const escritorio = {
  nome: "Escritório Exemplo Advogados",
  instancia: "Escritório Exemplo",
  plano: "Atendimento",
};

const screens = {
  overview: "Visão geral",
  conversations: "Conversas",
  plan: "Plano e limites",
};

const stats = [
  {
    label: "Leads novos",
    value: "36",
    change: "+12% vs semana passada",
    changeType: "positive",
    icon: IoPersonAddOutline,
  },
  {
    label: "Aguardando equipe",
    value: "22",
    change: "4 a mais que ontem",
    changeType: "negative",
    icon: IoHourglassOutline,
  },
  {
    label: "1ª resposta",
    value: "38 s",
    change: "6 s mais rápido",
    changeType: "positive",
    icon: IoTimeOutline,
  },
  {
    label: "Agendamentos",
    value: "14",
    change: "+3 nesta semana",
    changeType: "positive",
    icon: IoCalendarOutline,
  },
  {
    label: "Respostas da IA",
    value: "1.284",
    change: "26% do plano",
    changeType: "neutral",
    icon: IoSparklesOutline,
  },
];

const agenda = [
  {
    time: "09:00",
    title: "Reunião com Helena Prado",
    detail: "Trabalhista · on-line",
    status: "Confirmada",
    variant: "green-light",
  },
  {
    time: "11:30",
    title: "Triagem de Camila Nogueira",
    detail: "Família · retorno por WhatsApp",
    status: "Pendente",
    variant: "yellow-light",
  },
  {
    time: "14:00",
    title: "Consulta com Rafael Torres",
    detail: "Trabalhista · presencial",
    status: "Confirmada",
    variant: "green-light",
  },
  {
    time: "16:00",
    title: "Consulta com Mariana Almeida",
    detail: "Civil · on-line",
    status: "Pendente",
    variant: "yellow-light",
  },
];

const ultimasConversas = [
  {
    initials: "MA",
    name: "Mariana Almeida",
    area: "Civil",
    status: "Aguardando equipe",
    variant: "yellow-light",
    updated: "há 2 min",
    owner: "IA",
  },
  {
    initials: "RT",
    name: "Rafael Torres",
    area: "Trabalhista",
    status: "Em atendimento",
    variant: "blue-light",
    updated: "há 18 min",
    owner: "Ana (equipe)",
  },
  {
    initials: "CN",
    name: "Camila Nogueira",
    area: "Família",
    status: "Novo",
    variant: "purple-light",
    updated: "há 1 h",
    owner: "IA",
  },
  {
    initials: "HP",
    name: "Helena Prado",
    area: "Previdenciário",
    status: "Cliente",
    variant: "green-light",
    updated: "ontem",
    owner: "Bruno (equipe)",
  },
];

const conversas = [
  {
    initials: "MA",
    name: "Mariana Almeida",
    preview: "Preciso levar algum documento?",
    time: "16:41",
    unread: 1,
    active: true,
    status: "Aguardando equipe",
  },
  {
    initials: "RT",
    name: "Rafael Torres",
    preview: "Você: Enviei o modelo por e-mail",
    time: "15:18",
    unread: 0,
    active: false,
    status: "Em atendimento",
  },
  {
    initials: "CN",
    name: "Camila Nogueira",
    preview: "Obrigada! Vou separar os documentos",
    time: "14:05",
    unread: 2,
    active: false,
    status: "Novo",
  },
  {
    initials: "HP",
    name: "Helena Prado",
    preview: "Você: A consulta ficou para sexta.",
    time: "11:30",
    unread: 0,
    active: false,
    status: "Cliente",
  },
  {
    initials: "BS",
    name: "Bruno Sampaio",
    preview: "Você: O contrato segue em análise.",
    time: "ontem",
    unread: 0,
    active: false,
    status: "Em atendimento",
  },
];

const mensagens = [
  {
    from: "in",
    text: "Boa tarde. Preciso de ajuda com a revisão de um contrato de aluguel.",
    time: "16:21",
  },
  {
    from: "out",
    ia: true,
    text: "Boa tarde, Mariana. Posso ajudar. A revisão é de um contrato residencial ou comercial?",
    time: "16:22",
  },
  {
    from: "in",
    text: "Residencial. O contrato vence no mês que vem.",
    time: "16:24",
  },
  {
    from: "out",
    ia: true,
    text: "Entendi. Vou organizar sua triagem na área Civil. Você prefere atendimento pela manhã ou à tarde?",
    time: "16:25",
  },
  {
    from: "in",
    text: "À tarde, depois das 15h.",
    time: "16:27",
  },
  {
    from: "out",
    ia: true,
    text: "Perfeito. Sexta-feira, 14/11, às 16h, fica bom? A consulta é on-line.",
    time: "16:28",
  },
  {
    from: "in",
    text: "Fica ótimo. Preciso levar algum documento?",
    time: "16:41",
  },
];

const atividade = [
  {
    title: "Mariana perguntou sobre documentos",
    detail: "A IA pediu apoio da equipe antes de responder.",
    time: "há 2 min",
  },
  {
    title: "Consulta marcada para sex, 14/11, às 16h",
    detail: "On-line · lembrete automático enviado.",
    time: "há 14 min",
  },
  {
    title: "Triagem concluída",
    detail: "Área Civil · prioridade alta.",
    time: "há 18 min",
  },
  {
    title: "Primeira mensagem pelo WhatsApp",
    detail: "Origem: anúncio do site.",
    time: "hoje, 16:21",
  },
];

const usoPorSemana = [
  {
    semana: "13–19 out",
    respostas: "248",
    conversas: "62",
    agendamentos: "8",
    uso: "5%",
    status: "Dentro do limite",
    variant: "green-light",
  },
  {
    semana: "20–26 out",
    respostas: "312",
    conversas: "74",
    agendamentos: "11",
    uso: "6%",
    status: "Dentro do limite",
    variant: "green-light",
  },
  {
    semana: "27 out–02 nov",
    respostas: "358",
    conversas: "81",
    agendamentos: "9",
    uso: "7%",
    status: "Dentro do limite",
    variant: "green-light",
  },
  {
    semana: "03–09 nov",
    respostas: "366",
    conversas: "79",
    agendamentos: "10",
    uso: "7%",
    status: "Atenção",
    variant: "yellow-light",
  },
];

const limites = [
  ["Respostas da IA por mês", "5.000"],
  ["Contatos ativos", "2.000"],
  ["Instâncias de WhatsApp", "3"],
  ["Membros da equipe", "5"],
  ["Armazenamento de mídia", "10 GB"],
];

function useScreen() {
  const parse = () => {
    const hash = window.location.hash.replace("#", "");
    return ["visao-geral", "conversas", "plano"].includes(hash) ? hash : "visao-geral";
  };
  const [screen, setScreen] = useState(parse);
  useEffect(() => {
    const onChange = () => setScreen(parse());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return screen;
}

function useToasts() {
  const [toasts, setToasts] = useState([]);
  const push = (message, type = "info") => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((current) => [...current, { id, message, type }]);
  };
  const remove = (id) => setToasts((current) => current.filter((toast) => toast.id !== id));
  return { toasts, push, remove };
}

function Avatar({ children, size = "default" }) {
  return <span className={`wa-avatar wa-avatar-${size}`}>{children}</span>;
}

function PageHead({ eyebrow, title, subtitle, actions }) {
  return (
    <div className="wa-page-head">
      <div className="wa-page-heading">
        {eyebrow && <p className="wa-eyebrow">{eyebrow}</p>}
        <h1 className="wa-page-title">{title}</h1>
        {subtitle && <p className="wa-page-sub">{subtitle}</p>}
      </div>
      {actions && <div className="wa-page-actions">{actions}</div>}
    </div>
  );
}

function NavItem({ icon: Icon, label, href, count, countVariant = "default-light", screen, onDemo }) {
  if (!href) {
    return (
      <button type="button" className="wa-nav-item" onClick={onDemo} title={label}>
        <Icon className="wa-nav-icon" aria-hidden="true" />
        <span className="wa-nav-text">{label}</span>
        {count ? <span className={`wa-count-chip wa-chip-${countVariant}`}>{count}</span> : null}
      </button>
    );
  }
  const active = screen === href;
  return (
    <a
      href={`#${href}`}
      className={`wa-nav-item ${active ? "is-active" : ""}`}
      aria-current={active ? "page" : undefined}
      aria-label={label}
      title={label}
    >
      <Icon className="wa-nav-icon" aria-hidden="true" />
      <span className="wa-nav-text">{label}</span>
      {count ? <span className={`wa-count-chip wa-chip-${countVariant}`}>{count}</span> : null}
    </a>
  );
}

function Sidebar({ screen, open, onClose, pushToast }) {
  const demo = (label) =>
    pushToast(`A tela ${label} não faz parte desta exploração. Veja Visão geral, Conversas e Plano e limites.`, "info");
  return (
    <aside className={`wa-sidebar ${open ? "is-open" : ""}`} aria-label="Menu lateral">
      <div className="wa-brand">
        <span className="wa-mark" aria-hidden="true">
          <IoChatbubblesOutline size={18} />
        </span>
        <div className="wa-brand-copy">
          <div className="wa-brand-name">WhatsAI</div>
          <div className="wa-brand-sub">Atendimento com IA</div>
        </div>
        <button type="button" className="wa-icon-btn wa-only-mobile wa-sidebar-close" onClick={onClose} aria-label="Fechar menu">
          <IoCloseOutline />
        </button>
      </div>

      <div className="wa-instance">
        <Avatar size="sm">EE</Avatar>
        <div className="wa-instance-copy">
          <strong>{escritorio.instancia}</strong>
          <span>
            <i className="wa-dot wa-dot-ok" aria-hidden="true" /> WhatsApp conectado
          </span>
        </div>
        <IoChevronDownOutline className="wa-instance-chevron" aria-hidden="true" />
      </div>

      <nav className="wa-nav" aria-label="Navegação principal">
        <div className="wa-nav-label">Atendimento</div>
        <NavItem icon={IoGridOutline} label="Visão geral" href="visao-geral" screen={screen} />
        <NavItem
          icon={IoChatbubblesOutline}
          label="Conversas"
          href="conversas"
          count="3"
          countVariant="yellow-light"
          screen={screen}
        />
        <NavItem icon={IoPeopleOutline} label="Leads" onDemo={() => demo("Leads")} />
        <NavItem icon={IoCalendarOutline} label="Agenda" onDemo={() => demo("Agenda")} />
        <NavItem icon={IoBriefcaseOutline} label="Processos" count="1" countVariant="red-light" onDemo={() => demo("Processos")} />
        <NavItem
          icon={IoNotificationsOutline}
          label="Notificações"
          count="4"
          countVariant="red-light"
          onDemo={() => demo("Notificações")}
        />

        <div className="wa-nav-label">Escritório</div>
        <NavItem icon={IoCardOutline} label="Plano e limites" href="plano" screen={screen} />
        <NavItem icon={IoSparklesOutline} label="Atendente IA" onDemo={() => demo("Atendente IA")} />
        <NavItem icon={IoHardwareChipOutline} label="Conexão" onDemo={() => demo("Conexão")} />
        <NavItem icon={IoShieldCheckmarkOutline} label="Equipe e acessos" onDemo={() => demo("Equipe e acessos")} />
      </nav>

      <div className="wa-side-plan">
        <div className="wa-side-plan-top">
          <span>Plano {escritorio.plano}</span>
          <strong>26%</strong>
        </div>
        <ProgressBar value={26} size="sm" color="primary" />
        <a href="#plano" className="wa-side-link">
          Ver uso do mês <IoArrowForwardOutline size={12} aria-hidden="true" />
        </a>
      </div>

      <div className="wa-side-footer">
        <Avatar>EE</Avatar>
        <div className="wa-side-user">
          <strong>Equipe Exemplo</strong>
          <small>Administradora</small>
        </div>
        <button
          type="button"
          className="wa-icon-btn wa-icon-btn-plain"
          aria-label="Sair da conta"
          onClick={() => pushToast("Saída de conta não faz parte desta exploração.", "info")}
        >
          <IoLogOutOutline />
        </button>
      </div>
      <p className="wa-side-note">Protótipo com dados fictícios. Não é o painel em produção.</p>
    </aside>
  );
}

function Topbar({ screen, onMenu, pushToast }) {
  const title = screens[screen];
  return (
    <header className="wa-topbar">
      <button type="button" className="wa-icon-btn wa-only-mobile" onClick={onMenu} aria-label="Abrir menu">
        <IoMenuOutline />
      </button>
      <div className="wa-topbar-brand wa-only-mobile">WhatsAI</div>
      <div className="wa-crumb wa-hide-mobile">
        <span>{escritorio.instancia}</span>
        <IoChevronForwardOutline size={12} aria-hidden="true" />
        <strong>{title}</strong>
      </div>
      <Badge variant="default-light" size="sm" className="wa-hide-mobile">
        Exploração
      </Badge>

      <div className="wa-topbar-right">
        <button
          type="button"
          className="wa-search wa-hide-sm"
          onClick={() => pushToast("A busca com Ctrl K não faz parte desta exploração.", "info")}
        >
          <IoSearchOutline size={15} aria-hidden="true" />
          <span>Buscar</span>
          <kbd>Ctrl K</kbd>
        </button>
        <button
          type="button"
          className="wa-icon-btn"
          aria-label="Notificações, 4 não vistas"
          onClick={() =>
            pushToast(
              "4 avisos: 1 conversa aguardando, 1 consulta pendente, 1 processo com andamento e o plano em 26%.",
              "info",
            )
          }
        >
          <IoNotificationsOutline />
          <span className="wa-count" aria-hidden="true">
            4
          </span>
        </button>
        <ThemeToggle size="sm" variant="outline" className="wa-theme-toggle" />
        <div className="wa-user">
          <Avatar>EE</Avatar>
          <div className="wa-user-copy wa-hide-mobile">
            <strong>Equipe Exemplo</strong>
            <small>Administradora</small>
          </div>
        </div>
      </div>
    </header>
  );
}

function Chart() {
  const leads = "34,100 50,88 66,96 82,76 98,84 114,72 130,92 146,80 162,64 178,72 194,88 210,60 226,68 242,76 258,56 274,64 290,80 306,52 322,60 338,72 354,48 370,56 386,64 402,44 418,52 434,60 450,40 466,48 482,36 498,44 510,32";
  const agendamentos = "34,140 50,128 66,140 82,128 98,116 114,128 130,140 146,116 162,128 178,116 194,128 210,104 226,116 242,128 258,116 274,104 290,116 306,128 322,104 338,116 354,92 370,104 386,116 402,104 418,92 434,104 450,116 466,92 482,104 498,92 510,104";
  return (
    <>
      <svg
        className="wa-chart"
        viewBox="0 0 520 180"
        role="img"
        aria-label="Gráfico de linhas dos últimos 30 dias: leads novos variam de 2 a 9 por dia e agendamentos de 0 a 4 por dia."
      >
        <g className="wa-chart-grid" aria-hidden="true">
          <line x1="34" y1="20" x2="510" y2="20" />
          <line x1="34" y1="60" x2="510" y2="60" />
          <line x1="34" y1="100" x2="510" y2="100" />
          <line x1="34" y1="140" x2="510" y2="140" />
        </g>
        <g className="wa-chart-labels" aria-hidden="true">
          <text x="4" y="24">10</text>
          <text x="4" y="64">6,7</text>
          <text x="4" y="104">3,3</text>
          <text x="10" y="144">0</text>
          <text x="34" y="164">13/10</text>
          <text x="470" y="164">hoje</text>
        </g>
        <polyline className="wa-chart-line wa-chart-line-leads" points={leads} />
        <polyline className="wa-chart-line wa-chart-line-agenda" points={agendamentos} />
        <circle className="wa-chart-dot wa-chart-dot-leads" cx="510" cy="32" r="3.5" />
        <circle className="wa-chart-dot wa-chart-dot-agenda" cx="510" cy="104" r="3.5" />
      </svg>
      <div className="wa-legend">
        <span>
          <i className="wa-swatch wa-swatch-leads" aria-hidden="true" /> Leads novos
        </span>
        <span>
          <i className="wa-swatch wa-swatch-agenda" aria-hidden="true" /> Agendamentos
        </span>
      </div>
    </>
  );
}

function Overview({ pushToast }) {
  const [periodo, setPeriodo] = useState("7");
  return (
    <>
      <PageHead
        eyebrow={`${escritorio.nome} · protótipo com dados fictícios`}
        title="Visão geral"
        subtitle="Como foi a semana no atendimento, em uma olhada."
        actions={
          <>
            <Tabs value={periodo} onValueChange={setPeriodo} className="wa-period-tabs">
              <TabsList aria-label="Período dos números">
                <TabsTrigger value="7">7 dias</TabsTrigger>
                <TabsTrigger value="30">30 dias</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button
              variant="outline"
              size="sm"
              iconLeft={<IoRefreshOutline aria-hidden="true" />}
              onClick={() => pushToast("Dados atualizados agora. Nenhuma novidade desde a última consulta.", "info")}
            >
              Atualizar
            </Button>
          </>
        }
      />

      <div className="wa-stats">
        {stats.map((item) => {
          const Icon = item.icon;
          return (
            <StatCard
              key={item.label}
              className="wa-statcard"
              label={item.label}
              value={item.value}
              change={item.change}
              changeType={item.changeType}
              icon={<Icon size={18} aria-hidden="true" />}
            />
          );
        })}
      </div>

      <div className="wa-grid-2">
        <Card variant="outlined" className="wa-card">
          <div className="wa-card-head">
            <div>
              <h2 className="wa-card-title">Movimento dos últimos 30 dias</h2>
              <p className="wa-card-sub">Leads novos e agendamentos por dia.</p>
            </div>
            <Badge variant="green-light" size="sm">
              WhatsApp conectado
            </Badge>
          </div>
          <div className="wa-card-body">
            <Chart />
          </div>
        </Card>

        <Card variant="outlined" className="wa-card">
          <div className="wa-card-head">
            <div>
              <h2 className="wa-card-title">Hoje</h2>
              <p className="wa-card-sub">Agenda e o que pede atenção.</p>
            </div>
            <button
              type="button"
              className="wa-link"
              onClick={() => pushToast("A agenda completa não faz parte desta exploração.", "info")}
            >
              Ver agenda
            </button>
          </div>
          <div className="wa-today">
            {agenda.map((item) => (
              <div className="wa-today-row" key={`${item.time}-${item.title}`}>
                <span className="wa-today-time">{item.time}</span>
                <div className="wa-today-copy">
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </div>
                <Badge variant={item.variant} size="sm">
                  {item.status}
                </Badge>
              </div>
            ))}
            <button
              type="button"
              className="wa-today-attention"
              onClick={() => pushToast("3 leads aguardando há mais de 2 h. A triagem pede atenção.", "info")}
            >
              <IoAlertCircleOutline size={16} aria-hidden="true" />
              <span>
                <strong>3 leads</strong> aguardando há mais de 2 h
              </span>
              <IoChevronForwardOutline size={12} aria-hidden="true" />
            </button>
            <div className="wa-today-foot">
              <div className="wa-today-foot-top">
                <span>Respostas da IA hoje</span>
                <strong>86 de 300</strong>
              </div>
              <ProgressBar value={29} size="sm" color="primary" />
            </div>
          </div>
        </Card>
      </div>

      <Card variant="outlined" className="wa-card wa-table-card">
        <div className="wa-card-head">
          <div>
            <h2 className="wa-card-title">Últimas conversas</h2>
            <p className="wa-card-sub">O que chegou e quem está atendendo.</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            iconRight={<IoArrowForwardOutline aria-hidden="true" />}
            onClick={() => {
              window.location.hash = "conversas";
            }}
          >
            Ver todas
          </Button>
        </div>
        <Table className="wa-table">
          <TableHeader>
            <TableRow>
              <TableHead>
                <span className="wa-th">
                  <IoPeopleOutline size={12} aria-hidden="true" /> Contato
                </span>
              </TableHead>
              <TableHead>
                <span className="wa-th">
                  <IoScaleOutline size={12} aria-hidden="true" /> Área
                </span>
              </TableHead>
              <TableHead>
                <span className="wa-th">
                  <IoPulseOutline size={12} aria-hidden="true" /> Status
                </span>
              </TableHead>
              <TableHead>
                <span className="wa-th">
                  <IoTimeOutline size={12} aria-hidden="true" /> Atualizado
                </span>
              </TableHead>
              <TableHead>
                <span className="wa-th">
                  <IoChatbubblesOutline size={12} aria-hidden="true" /> Atendente
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ultimasConversas.map((item) => (
              <TableRow key={item.name}>
                <TableCell>
                  <span className="wa-person">
                    <Avatar size="sm">{item.initials}</Avatar>
                    <strong>{item.name}</strong>
                  </span>
                </TableCell>
                <TableCell>{item.area}</TableCell>
                <TableCell>
                  <Badge variant={item.variant} size="sm">
                    {item.status}
                  </Badge>
                </TableCell>
                <TableCell className="wa-muted-cell">{item.updated}</TableCell>
                <TableCell className="wa-hide-sm">{item.owner}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}

function Message({ message }) {
  return (
    <div className={`wa-msg wa-msg-${message.from}`}>
      {message.ia && <span className="wa-ia-chip">IA</span>}
      <div className="wa-bubble">
        {message.text}
        <time>{message.time}</time>
      </div>
    </div>
  );
}

function ConversationDetails({ pushToast }) {
  return (
    <Card variant="outlined" className="wa-conv-details">
      <div className="wa-details-head">
        <div>
          <strong>Ficha do lead</strong>
          <span>Atualizada há 2 min</span>
        </div>
        <Badge variant="yellow-light" size="sm">
          Aguardando
        </Badge>
      </div>
      <div className="wa-details-body">
        <div className="wa-who">
          <Avatar size="lg">MA</Avatar>
          <div>
            <strong>Mariana Almeida</strong>
            <span>(11) 9••••-0101 · Campinas</span>
          </div>
        </div>

        <div className="wa-badges-row">
          <Badge variant="red-light" size="sm">
            Prioridade alta
          </Badge>
          <Badge variant="purple-light" size="sm">
            Civil
          </Badge>
          <Badge variant="green-light" size="sm">
            IA ativa
          </Badge>
        </div>

        <Alert
          variant="warning"
          title="A IA pediu apoio da equipe"
          className="wa-alert-compact"
          icon={<IoWarningOutline size={16} aria-hidden="true" />}
        >
          Ela respondeu até aqui, mas prefere que uma pessoa confirme os documentos antes da consulta.
        </Alert>

        <Tabs defaultValue="resumo" className="wa-detail-tabs">
          <TabsList>
            <TabsTrigger value="resumo">Resumo</TabsTrigger>
            <TabsTrigger value="atividade">Atividade</TabsTrigger>
          </TabsList>
          <TabsContent value="resumo">
            <dl className="wa-kv">
              <dt>Área</dt>
              <dd>Civil</dd>
              <dt>Cidade</dt>
              <dd>Campinas</dd>
              <dt>Origem</dt>
              <dd>WhatsApp</dd>
              <dt>Responsável</dt>
              <dd>Equipe de triagem</dd>
              <dt>Falta saber</dt>
              <dd>Documentos do imóvel</dd>
            </dl>

            <div className="wa-detail-section">
              <span className="wa-section-label">Próximo passo</span>
              <p>Confirmar os documentos e assumir a conversa antes da consulta.</p>
            </div>

            <div className="wa-detail-section">
              <span className="wa-section-label">Agenda</span>
              <p className="wa-agenda-item">
                <strong>Consulta · sex 14/11, 16:00</strong>
                <span>On-line · lembrete enviado</span>
              </p>
            </div>

            <div className="wa-detail-section">
              <span className="wa-section-label">Processos</span>
              <p className="wa-muted">Nenhum vinculado.</p>
            </div>
          </TabsContent>
          <TabsContent value="atividade">
            <div className="wa-timeline">
              {atividade.map((item) => (
                <div className="wa-timeline-item" key={item.title}>
                  <i className="wa-timeline-dot" aria-hidden="true" />
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.detail}</span>
                    <small>{item.time}</small>
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>

        <Button
          variant="outline"
          size="sm"
          className="wa-full"
          iconLeft={<IoDocumentTextOutline aria-hidden="true" />}
          onClick={() => pushToast("A ficha completa abre em uma página própria nesta exploração.", "info")}
        >
          Abrir ficha completa
        </Button>
      </div>
    </Card>
  );
}

function Conversations({ assumida, setAssumida, pushToast }) {
  const assumir = () => {
    if (assumida) return;
    setAssumida(true);
    pushToast("Conversa assumida. A IA foi pausada neste contato.", "success");
  };

  return (
    <>
      <PageHead
        eyebrow="Protótipo com dados fictícios · 3 conversas abertas"
        title="Conversas"
        subtitle="A equipe e a IA no mesmo lugar. A ficha do lead fica ao lado."
        actions={
          <Button
            variant="outline"
            size="sm"
            iconLeft={<IoFilterOutline aria-hidden="true" />}
            onClick={() => pushToast("Os filtros de conversa não fazem parte desta exploração.", "info")}
          >
            Filtrar
          </Button>
        }
      />

      <div className="wa-conv-layout">
        <Card variant="outlined" className="wa-conv-list">
          <div className="wa-conv-list-head">
            <strong>Caixa de entrada</strong>
            <Badge variant="yellow-light" size="sm">
              3 aguardando
            </Badge>
          </div>
          <div className="wa-conv-search">
            <IoSearchOutline size={14} aria-hidden="true" />
            <input type="search" placeholder="Buscar conversa" aria-label="Buscar conversa" />
          </div>
          <div className="wa-conv-items">
            {conversas.map((item) => (
              <button
                type="button"
                key={item.name}
                className={`wa-conv-item ${item.active ? "is-active" : ""}`}
                onClick={() =>
                  !item.active && pushToast("Esta exploração mostra apenas a conversa da Mariana.", "info")
                }
              >
                <Avatar size="md">{item.initials}</Avatar>
                <span className="wa-conv-item-copy">
                  <span className="wa-conv-item-top">
                    <strong>{item.name}</strong>
                    <time>{item.time}</time>
                  </span>
                  <span className="wa-conv-item-preview">{item.preview}</span>
                  <span className="wa-conv-item-status">{item.status}</span>
                </span>
                {item.unread > 0 && (
                  <span className="wa-unread" aria-label={`${item.unread} não lidas`}>
                    {item.unread}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="wa-conv-list-foot">
            <span>
              <i className="wa-dot wa-dot-ok" aria-hidden="true" /> IA respondendo
            </span>
            <span>3 abertas</span>
          </div>
        </Card>

        <Card variant="outlined" className="wa-chat">
          <div className="wa-chat-head">
            <a href="#visao-geral" className="wa-icon-btn wa-only-mobile" aria-label="Voltar para a visão geral">
              <IoArrowBackOutline />
            </a>
            <Avatar>MA</Avatar>
            <div className="wa-chat-who">
              <strong>Mariana Almeida</strong>
              <span>WhatsApp · (11) 9••••-0101</span>
            </div>
            <div className="wa-chat-badges">
              <Badge variant={assumida ? "yellow-light" : "green-light"} size="sm">
                {assumida ? "IA pausada" : "IA ativa"}
              </Badge>
              <Badge variant={assumida ? "blue-light" : "yellow-light"} size="sm" className="wa-hide-wide">
                {assumida ? "Em atendimento" : "Aguardando equipe"}
              </Badge>
            </div>
            <div className="wa-chat-actions">
              <Button
                variant="ghost"
                size="sm"
                className="wa-hide-sm wa-hide-md"
                iconLeft={<IoDocumentTextOutline aria-hidden="true" />}
                onClick={() => pushToast("A ficha completa abre em uma página própria nesta exploração.", "info")}
              >
                Ficha
              </Button>
              <Button size="sm" onClick={assumir} disabled={assumida}>
                <span className="wa-btn-long">{assumida ? "Conversa assumida" : "Assumir conversa"}</span>
                <span className="wa-btn-short">{assumida ? "Assumida" : "Assumir"}</span>
              </Button>
            </div>
          </div>

          <div className="wa-chat-context">
            <span>
              <b>Área</b> Civil
            </span>
            <span>
              <b>Prioridade</b> Alta
            </span>
            <span>
              <b>Consulta</b> sex 14/11, 16h
            </span>
            <span>
              <b>IA</b> {assumida ? "pausada" : "ativa"}
            </span>
          </div>

          <div className="wa-messages" aria-label="Mensagens da conversa">
            <div className="wa-day-divider">
              <span>Hoje</span>
            </div>
            {mensagens.map((message) => (
              <Message key={`${message.time}-${message.text.slice(0, 12)}`} message={message} />
            ))}
          </div>

          <div className="wa-composer">
            <div className="wa-composer-box">
              <button type="button" className="wa-composer-icon" aria-label="Anexar arquivo">
                <IoAttachOutline />
              </button>
              <input type="text" placeholder="Digite uma mensagem" aria-label="Digite uma mensagem" />
              <button
                type="button"
                className="wa-send"
                aria-label="Enviar mensagem"
                onClick={() => pushToast("Mensagem enviada (exemplo).", "success")}
              >
                <IoPaperPlaneOutline />
              </button>
            </div>
            <p className="wa-composer-help">
              Amostra com dados fictícios. A IA pausa quando alguém da equipe assume.
            </p>
          </div>
        </Card>

        <ConversationDetails pushToast={pushToast} />
      </div>
    </>
  );
}

function Plan({ pushToast }) {
  return (
    <>
      <PageHead
        eyebrow={`${escritorio.nome} · protótipo com dados fictícios`}
        title="Plano e limites"
        subtitle={`Uso do mês e limites do plano ${escritorio.plano}.`}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              iconLeft={<IoDownloadOutline aria-hidden="true" />}
              onClick={() => pushToast("Relatório de uso gerado (exemplo).", "success")}
            >
              Exportar uso
            </Button>
            <Button
              size="sm"
              iconLeft={<IoHeadsetOutline aria-hidden="true" />}
              onClick={() => pushToast("Pedido de suporte registrado (exemplo). Retornamos em até 1 dia útil.", "info")}
            >
              Falar com suporte
            </Button>
          </>
        }
      />

      <Alert
        variant="success"
        title="Plano saudável"
        className="wa-alert-plan"
        icon={<IoCheckmarkCircleOutline size={18} aria-hidden="true" />}
      >
        26% das respostas da IA usadas em novembro. O ciclo recomeça em 1º de dezembro.
      </Alert>

      <div className="wa-metrics">
        <MetricCard title="Respostas da IA" value="1.284" subtitle="de 5.000 no mês">
          <div className="wa-metric-row">
            <span>Hoje</span>
            <b>86</b>
          </div>
          <div className="wa-metric-row">
            <span>Ontem</span>
            <b>112</b>
          </div>
          <div className="wa-metric-row">
            <span>Nesta semana</span>
            <b>640</b>
          </div>
        </MetricCard>
        <MetricCard title="Instâncias" value="1 de 3" subtitle="Escritório Exemplo conectada">
          <div className="wa-metric-row">
            <span>WhatsApp</span>
            <Badge variant="green-light" size="sm">
              Conectado
            </Badge>
          </div>
          <div className="wa-metric-row">
            <span>Banco próprio</span>
            <Badge variant="default-light" size="sm">
              Não usado
            </Badge>
          </div>
        </MetricCard>
        <MetricCard title="Contatos ativos" value="842" subtitle="de 2.000 no plano">
          <ProgressBar value={42} size="sm" color="success" />
          <p className="wa-metric-note">42% do limite de contatos.</p>
        </MetricCard>
      </div>

      <div className="wa-grid-plan">
        <Card variant="outlined" className="wa-card">
          <div className="wa-card-head">
            <div>
              <h2 className="wa-card-title">Uso do plano</h2>
              <p className="wa-card-sub">Novembro de 2026 · atualizado agora.</p>
            </div>
            <Badge variant="green-light" size="sm">
              Dentro do limite
            </Badge>
          </div>
          <div className="wa-card-body wa-progress-list">
            <div className="wa-progress-row">
              <ProgressBar value={26} label="Respostas da IA" showPercentage color="primary" />
              <p>1.284 de 5.000 respostas. Restam 3.716 neste ciclo.</p>
            </div>
            <div className="wa-progress-row">
              <ProgressBar value={42} label="Contatos ativos" showPercentage color="success" />
              <p>842 de 2.000 contatos. O limite acompanha o número de pessoas atendidas.</p>
            </div>
            <div className="wa-progress-row">
              <ProgressBar value={18} label="Armazenamento de mídia" showPercentage color="primary" />
              <p>1,8 GB de 10 GB em áudios, imagens e documentos.</p>
            </div>
            <div className="wa-progress-row">
              <ProgressBar value={1} max={3} label="Instâncias de WhatsApp" showPercentage color="success" />
              <p>1 de 3 instâncias conectadas.</p>
            </div>
          </div>
        </Card>

        <Card variant="outlined" className="wa-card">
          <div className="wa-card-head">
            <div>
              <h2 className="wa-card-title">Limites do plano</h2>
              <p className="wa-card-sub">O que está incluído no plano {escritorio.plano}.</p>
            </div>
          </div>
          <div className="wa-limits">
            {limites.map(([label, value]) => (
              <div className="wa-limit-row" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
            <div className="wa-limit-row">
              <span>Suporte</span>
              <Badge variant="green-light" size="sm">
                Incluído
              </Badge>
            </div>
          </div>
          <div className="wa-card-foot">
            <Button
              variant="ghost"
              size="sm"
              iconLeft={<IoMailOutline aria-hidden="true" />}
              onClick={() => pushToast("Pedido de suporte registrado (exemplo).", "info")}
            >
              Tirar uma dúvida
            </Button>
          </div>
        </Card>
      </div>

      <Card variant="outlined" className="wa-card wa-table-card">
        <div className="wa-card-head">
          <div>
            <h2 className="wa-card-title">Consumo por semana</h2>
            <p className="wa-card-sub">As últimas quatro semanas do ciclo.</p>
          </div>
          <Badge variant="default-light" size="sm">
            Novembro
          </Badge>
        </div>
        <Table className="wa-table">
          <TableHeader>
            <TableRow>
              <TableHead>Semana</TableHead>
              <TableHead>Respostas da IA</TableHead>
              <TableHead className="wa-hide-sm">Conversas</TableHead>
              <TableHead className="wa-hide-sm">Agendamentos</TableHead>
              <TableHead>Uso</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {usoPorSemana.map((item) => (
              <TableRow key={item.semana}>
                <TableCell>
                  <strong>{item.semana}</strong>
                </TableCell>
                <TableCell>{item.respostas}</TableCell>
                <TableCell className="wa-hide-sm">{item.conversas}</TableCell>
                <TableCell className="wa-hide-sm">{item.agendamentos}</TableCell>
                <TableCell>{item.uso}</TableCell>
                <TableCell>
                  <Badge variant={item.variant} size="sm">
                    {item.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}

function App() {
  const screen = useScreen();
  const { toasts, push, remove } = useToasts();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [assumida, setAssumida] = useState(false);

  useEffect(() => {
    setSidebarOpen(false);
  }, [screen]);

  const activeScreen = useMemo(
    () => (screen === "conversas" ? "conversations" : screen === "plano" ? "plan" : "overview"),
    [screen],
  );

  return (
    <div className={`wa-app wa-screen-${activeScreen}`}>
      {sidebarOpen && (
        <button
          type="button"
          className="wa-backdrop"
          aria-label="Fechar menu"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <Sidebar screen={screen} open={sidebarOpen} onClose={() => setSidebarOpen(false)} pushToast={push} />
      <div className="wa-main">
        <Topbar screen={activeScreen} onMenu={() => setSidebarOpen(true)} pushToast={push} />
        <main className={`wa-content ${activeScreen === "conversations" ? "wa-content-conv" : ""}`}>
          {activeScreen === "overview" && <Overview pushToast={push} />}
          {activeScreen === "conversations" && (
            <Conversations assumida={assumida} setAssumida={setAssumida} pushToast={push} />
          )}
          {activeScreen === "plan" && <Plan pushToast={push} />}
        </main>
      </div>
      <ToastContainer toasts={toasts} removeToast={remove} />
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <ThemeProvider defaultTheme="light" enableSystem={false} storageKey={THEME_KEY}>
    <App />
  </ThemeProvider>,
);
