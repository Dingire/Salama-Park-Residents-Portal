import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ClerkProvider, Show, SignIn, SignUp, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { RegistrationForm } from '@/components/registration-form';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  useGetPublicOverview, getGetPublicOverviewQueryKey,
  useGetPublicDocuments, getGetPublicDocumentsQueryKey,
  useGetPublicAnnouncements, getGetPublicAnnouncementsQueryKey,
  useGetPublicPetition, getGetPublicPetitionQueryKey,
  useGetPublicPollResults, getGetPublicPollResultsQueryKey,
  useGetMyResidentApplication, getGetMyResidentApplicationQueryKey,
  useSubmitResidentApplication, useSubmitPetitionConsent,
  useGetMyPetitionReceipts, getGetMyPetitionReceiptsQueryKey,
  useWithdrawMyPetitionSignature,
  useGetAdminAccess, getGetAdminAccessQueryKey,
  useGetAdminDashboard, getGetAdminDashboardQueryKey,
  useGetAdminApplications, getGetAdminApplicationsQueryKey,
  useReviewMembershipApplication,
  useGetAdminPetitionSubmissions, getGetAdminPetitionSubmissionsQueryKey,
  useVerifyPetitionSubmission,
  useGetAdminRegisterSnapshots, getGetAdminRegisterSnapshotsQueryKey,
  useCreateAdminRegisterSnapshot,
  useGetAdminPetitionConfiguration, getGetAdminPetitionConfigurationQueryKey,
  useSaveAdminPetitionConfiguration,
  useApproveAdminPetitionConfiguration,
  useCloseAdminPetitionConfiguration,
  useGetAdminRoles, getGetAdminRolesQueryKey,
  useGrantAdminRole,
  useRevokeAdminRole,
} from '@workspace/api-client-react';
import type { ResidentApplicationInput } from '@workspace/api-client-react';
import {
  ArrowRight, ArrowUpRight, BadgeCheck, ChevronDown, ClipboardCheck, FileText, Landmark, LockKeyhole,
  Menu, ShieldCheck, UserRound, X,
} from 'lucide-react';
import { Link, Redirect, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
function stripBase(path: string) { return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path; }
if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');

const clerkAppearance = {
  theme: shadcn, cssLayerName: 'clerk',
  options: { logoPlacement: 'inside' as const, logoLinkUrl: basePath || '/', logoImageUrl: `${window.location.origin}${basePath}/logo.svg` },
  variables: { colorPrimary: '#315f43', colorForeground: '#172a43', colorMutedForeground: '#617084', colorDanger: '#a53d3d', colorBackground: '#fffefa', colorInput: '#fbfaf6', colorInputForeground: '#172a43', colorNeutral: '#d9ddd7', fontFamily: 'DM Sans', borderRadius: '0.75rem' },
  elements: {
    rootBox: 'w-full flex justify-center', cardBox: 'bg-[#fffefa] rounded-2xl w-[440px] max-w-full overflow-hidden border border-[#d9ddd7] shadow-xl',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none', footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#172a43] font-bold', headerSubtitle: 'text-[#617084]', socialButtonsBlockButtonText: 'text-[#172a43]',
    formFieldLabel: 'text-[#172a43]', footerActionLink: 'text-[#315f43]', footerActionText: 'text-[#617084]', dividerText: 'text-[#617084]',
    identityPreviewEditButton: 'text-[#315f43]', formFieldSuccessText: 'text-[#315f43]', alertText: 'text-[#172a43]',
    logoBox: 'rounded-xl', logoImage: 'rounded-lg', socialButtonsBlockButton: 'border-[#d9ddd7] bg-white',
    formButtonPrimary: 'bg-[#315f43] hover:bg-[#264d35] text-white', formFieldInput: 'border-[#d9ddd7] text-[#172a43] bg-[#fbfaf6]',
    footerAction: 'text-[#617084]', dividerLine: 'bg-[#d9ddd7]', alert: 'border-[#d9ddd7]', otpCodeFieldInput: 'border-[#d9ddd7]',
    formFieldRow: 'text-[#172a43]', main: 'text-[#172a43]',
  },
};

const mainNav = [
  ['About', '/about'], ['Documents', '/documents'], ['Petition', '/petition'], ['Notices', '/announcements'],
  ['Elections', '/elections'], ['FAQ', '/faq'],
];
const residentNav = [
  ['Overview', '/resident/dashboard'], ['My profile', '/resident/profile'], ['Application', '/resident/application'],
  ['Petition', '/resident/petition'], ['Voting', '/resident/voting'], ['Receipts', '/resident/receipts'], ['Notifications', '/resident/notifications'],
];
const adminNav = [
  ['Dashboard', '/admin/dashboard'], ['Members', '/admin/members'], ['Verifications', '/admin/verifications'],
  ['Petitions', '/admin/petitions'], ['Register snapshots', '/admin/register-snapshots'], ['Documents', '/admin/documents'],
  ['Resolutions', '/admin/resolutions'], ['Elections', '/admin/elections'], ['Candidates', '/admin/candidates'],
  ['Results', '/admin/results'], ['Meetings', '/admin/meetings'], ['Announcements', '/admin/announcements'],
  ['Reports', '/admin/reports'], ['Audit logs', '/admin/audit-logs'], ['Settings', '/admin/settings'],
];
const publicTitles: Record<string, [string, string]> = {
  '/about': ['A process built for trust.', 'How the association is establishing a clear, transparent governance foundation.'],
  '/documents': ['The public record.', 'Approved governance documents are published here with their exact versions.'],
  '/petition': ['A declaration, not a checkbox.', 'Review the petition status and the exact governance versions before any consent is recorded.'],
  '/membership': ['Start your membership application.', 'Submitting an application begins verification. It does not automatically make you a verified member.'],
  '/announcements': ['Notices from the association.', 'Public updates will appear here once approved and published.'],
  '/elections': ['Election status.', 'Election information will be published when the association has formally configured the process.'],
  '/results': ['Verified results.', 'Only formally published and verified results belong here.'],
  '/privacy': ['Your information. Used with care.', 'A plain-language notice about the personal information used in resident applications.'],
  '/faq': ['Questions, answered plainly.', 'A few essentials about how this portal works.'],
  '/contact': ['Contact the association.', 'Contact details will be published here once confirmed by the association.'],
};
const adminCopy: Record<string, string> = {
  '/admin/dashboard': 'Governance workspace overview', '/admin/members': 'Resident membership register', '/admin/verifications': 'Review resident verification',
  '/admin/petitions': 'Petition configuration and consent', '/admin/register-snapshots': 'Approved register snapshots', '/admin/documents': 'Governance document publishing',
  '/admin/resolutions': 'Association resolutions', '/admin/elections': 'Election configuration', '/admin/candidates': 'Candidate register',
  '/admin/results': 'Election results publishing', '/admin/meetings': 'Meetings and minutes', '/admin/announcements': 'Public announcements',
  '/admin/reports': 'Governance reports', '/admin/audit-logs': 'Administrative audit trail', '/admin/settings': 'Roles and administrative access',
};

function Brand({ inverse = false }: { inverse?: boolean }) {
  return <Link href="/" className={`brand flex items-center gap-3 ${inverse ? 'text-white' : 'text-[#172a43]'}`} data-testid="link-brand">
    <span className={`grid size-10 place-items-center rounded-xl ${inverse ? 'bg-white/10' : 'bg-[#e6eee5]'}`}><Landmark size={20} strokeWidth={1.8} /></span>
    <span className="leading-tight"><strong className="block text-[14px] font-bold tracking-[-.02em]">Salama Park</strong><span className={`text-[10px] tracking-[.12em] uppercase ${inverse ? 'text-white/55' : 'text-[#667384]'}`}>Residents Association</span></span>
  </Link>;
}

function AppShell({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  const [open, setOpen] = useState(false);
  const { isSignedIn } = useUser();
  const { signOut } = useClerk();
  return <div className="app-shell grain">
    <div className="bg-[#152944] px-4 py-2 text-center text-[11px] tracking-[.015em] text-white/80">
      Official resident information · Lusaka, Zambia <span className="mx-2 text-white/25">/</span><Link href="/documents" className="underline decoration-white/35 underline-offset-4 hover:text-white">View the public record</Link>
    </div>
    <header className="relative z-30 border-b border-[#e4e2db] bg-[#faf9f5]">
      <div className="mx-auto flex min-h-[76px] max-w-[1320px] items-center justify-between px-5 lg:px-10">
        <Brand />
        <nav className="hidden items-center gap-1 lg:flex">{mainNav.map(([label, href]) => <Link key={href} href={href} className="nav-link rounded-lg px-3 py-2 text-[13px] font-medium text-[#415067]" data-testid={`nav-${href.slice(1)}`}>{label}</Link>)}</nav>
        <div className="hidden items-center gap-2 lg:flex">
          {isSignedIn ? <><Link href="/resident/dashboard" className="rounded-lg px-3 py-2 text-sm font-semibold text-[#315f43]">Resident portal</Link><button onClick={() => signOut({ redirectUrl: basePath || '/' })} className="btn-secondary">Sign out</button></> :
            <><Link href="/login" className="rounded-lg px-3 py-2 text-sm font-semibold text-[#38495f] hover:bg-[#eeede7]">Sign in</Link><Link href="/membership" className="btn-primary">Apply for membership <ArrowRight size={15} /></Link></>}
        </div>
        <button className="grid size-10 place-items-center rounded-lg border border-[#dfded7] lg:hidden" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen(!open)} data-testid="button-mobile-menu">{open ? <X size={19} /> : <Menu size={19} />}</button>
      </div>
      {open && <div className="border-t border-[#e4e2db] bg-[#faf9f5] px-5 py-4 lg:hidden"><nav className="mx-auto grid max-w-lg grid-cols-2 gap-1">{mainNav.map(([label, href]) => <Link onClick={() => setOpen(false)} key={href} href={href} className="nav-link rounded-lg px-3 py-3 text-sm font-medium">{label}</Link>)}<Link href="/membership" onClick={() => setOpen(false)} className="col-span-2 mt-2 rounded-lg bg-[#315f43] px-4 py-3 text-center text-sm font-semibold text-white">Apply for membership</Link></nav></div>}
    </header>
    <main>{children}</main>
    <footer className="border-t border-[#e4e2db] bg-[#f0efe9]">
      <div className="mx-auto grid max-w-[1320px] gap-10 px-5 py-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr] lg:px-10">
        <div><Brand /><p className="mt-4 max-w-sm text-sm leading-6 text-[#637083]">A clear public record for residents of Salama Park, Lusaka. Official updates are published here as they are approved.</p></div>
        <div><p className="mb-3 text-xs font-bold uppercase tracking-[.14em] text-[#6e7884]">Explore</p><div className="grid grid-cols-2 gap-y-2">{[['About','/about'],['Documents','/documents'],['Petition','/petition'],['Elections','/elections'],['Results','/results'],['Announcements','/announcements']].map(([label,href]) => <Link key={href} href={href} className="text-sm text-[#415067] hover:text-[#315f43]">{label}</Link>)}</div></div>
        <div><p className="mb-3 text-xs font-bold uppercase tracking-[.14em] text-[#6e7884]">Useful information</p><div className="grid grid-cols-2 gap-y-2"><Link href="/privacy" className="text-sm text-[#415067]">Privacy notice</Link><Link href="/faq" className="text-sm text-[#415067]">FAQ</Link><Link href="/contact" className="text-sm text-[#415067]">Contact</Link><Link href="/login" className="text-sm text-[#415067]">Resident sign in</Link></div></div>
      </div>
      <div className="border-t border-[#deddd6] py-4 text-center text-[11px] text-[#74808d]">Salama Park Residents Association · Lusaka, Zambia</div>
    </footer>
  </div>;
}

function StatusPill({ children }: { children: ReactNode }) { return <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-semibold tracking-wide text-white"><span className="size-1.5 rounded-full bg-[#82b68d]" />{children}</span>; }
function Eyebrow({ children, inverse = false }: { children: ReactNode; inverse?: boolean }) { return <div className={`mb-4 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.17em] ${inverse ? 'text-[#b0c8b3]' : 'text-[#477454]'}`}><span className="h-px w-6 bg-current" />{children}</div>; }
function ButtonLink({ href, children, secondary = false }: { href: string; children: ReactNode; secondary?: boolean }) { return <Link href={href} className={secondary ? 'btn-ghost' : 'btn-primary'}>{children}</Link>; }
function SectionTitle({ eyebrow, title, text }: { eyebrow: string; title: string; text?: string }) { return <div className="mb-7"><Eyebrow>{eyebrow}</Eyebrow><h2 className="serif max-w-2xl text-3xl font-bold tracking-[-.045em] text-[#182b43] sm:text-[38px]">{title}</h2>{text && <p className="mt-3 max-w-2xl text-[15px] leading-7 text-[#647083]">{text}</p>}</div>; }
function serverErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
      return data.error;
    }
  }
  return fallback;
}
function Notice({ children, kind = 'info' }: { children: ReactNode; kind?: 'info' | 'error' | 'success' }) { return <div className={`rounded-xl border px-4 py-3 text-sm leading-6 ${kind === 'error' ? 'border-[#e8caca] bg-[#fcf1ef] text-[#8a3737]' : kind === 'success' ? 'border-[#c8deca] bg-[#eef6ee] text-[#315f43]' : 'border-[#dce3dd] bg-[#f1f5f0] text-[#405a49]'}`}>{children}</div>; }

function HomePage() {
  const overview = useGetPublicOverview({ query: { queryKey: getGetPublicOverviewQueryKey() } });
  const petition = useGetPublicPetition({ query: { queryKey: getGetPublicPetitionQueryKey() } });
  const docs = useGetPublicDocuments({ query: { queryKey: getGetPublicDocumentsQueryKey() } });
  const announcements = useGetPublicAnnouncements({ query: { queryKey: getGetPublicAnnouncementsQueryKey() } });
  const status = overview.data?.petitionStatus ?? petition.data?.status;
  const statusText = status === 'open' ? 'Petition open' : status === 'scheduled' ? 'Petition scheduled' : status === 'closed' ? 'Petition closed' : 'Petition not configured';
  return <AppShell>
    <section className="topo relative overflow-hidden">
      <div className="pointer-events-none absolute -right-16 top-[-8rem] size-[520px] rounded-full border border-white/[.08] sm:right-[4%] sm:top-[-13rem] sm:size-[650px]"><div className="absolute inset-8 rounded-full border border-white/[.07]" /><div className="absolute inset-20 rounded-full border border-white/[.06]" /><div className="absolute inset-32 rounded-full border border-white/[.06]" /></div>
      <div className="relative mx-auto grid max-w-[1320px] gap-12 px-5 py-16 sm:py-24 lg:grid-cols-[1.15fr_.85fr] lg:items-center lg:px-10 lg:py-28">
        <div className="reveal max-w-[720px]"><StatusPill>Official resident portal</StatusPill><h1 className="serif mt-7 text-[46px] font-bold leading-[1.02] tracking-[-.055em] text-[#fbfaf5] sm:text-[66px] lg:text-[76px]">A shared future<br />starts with a<br /><span className="text-[#a8c8a6]">clear process.</span></h1><p className="mt-6 max-w-[510px] text-[16px] leading-7 text-white/70 sm:text-[18px]">The digital front door for Salama Park residents: governance documents, membership verification, petition consent and future elections.</p><div className="mt-8 flex flex-col gap-3 sm:flex-row"><ButtonLink href="/about">Understand the process <ArrowRight size={16} /></ButtonLink><ButtonLink href="/documents" secondary>Browse public documents</ButtonLink></div><div className="mt-8 flex items-center gap-2 text-[12px] text-white/55"><ShieldCheck size={15} className="text-[#a8c8a6]" />Official information. Published only when confirmed.</div></div>
        <div className="reveal-delay relative mx-auto w-full max-w-[440px] lg:ml-auto">
          <div className="absolute -inset-4 rounded-[28px] border border-white/[.1]" />
          <div className="relative rounded-[22px] border border-white/15 bg-[#fbfaf5] p-6 shadow-[0_24px_70px_rgba(4,17,35,.24)] sm:p-7">
            <div className="flex items-start justify-between gap-4"><div><Eyebrow>Current status</Eyebrow><h2 className="serif text-[25px] font-bold tracking-[-.04em] text-[#182b43]">Governance at a glance</h2></div><span className="grid size-10 place-items-center rounded-xl bg-[#eaf1e8] text-[#3c704b]"><ClipboardCheck size={20} /></span></div>
            <div className="mt-6 flex items-center justify-between border-y border-[#e8e6df] py-4"><span className="text-sm text-[#657184]">Petition</span><span className="rounded-full bg-[#eef1eb] px-2.5 py-1 text-[11px] font-semibold text-[#41684a]" data-testid="status-petition">{overview.isLoading || petition.isLoading ? 'Checking status' : statusText}</span></div>
            <div className="grid grid-cols-2 gap-4 py-5">
              <div><p className="text-[11px] font-semibold uppercase tracking-[.11em] text-[#84909a]">Accepted declarations</p><p className="serif mt-1 text-[32px] font-bold tracking-[-.04em] text-[#192d45]" data-testid="text-signature-count">{overview.data ? overview.data.acceptedPetitionSignatures : '—'}</p></div>
              <div><p className="text-[11px] font-semibold uppercase tracking-[.11em] text-[#84909a]">Threshold</p><p className="serif mt-1 text-[32px] font-bold tracking-[-.04em] text-[#192d45]">{overview.data?.proposedThreshold ?? petition.data?.proposedThreshold ?? '—'}</p></div>
            </div>
            {overview.isError ? <div className="mb-3 text-xs text-[#8a3737]">Status could not be loaded. <button onClick={() => overview.refetch()} className="underline">Retry</button></div> : null}
            <div className="rounded-xl bg-[#f1f2ed] p-4"><div className="flex gap-3"><span className="mt-0.5 text-[#477454]"><LockKeyhole size={16} /></span><p className="text-[12px] leading-5 text-[#596778]">Membership verification figures are shown only when an approved register denominator is available.</p></div></div>
            <Link href="/petition" className="mt-4 flex items-center justify-between border-t border-[#e8e6df] pt-4 text-sm font-semibold text-[#315f43]">Read petition information <ArrowUpRight size={16} /></Link>
          </div>
        </div>
      </div>
    </section>
    <section className="mx-auto max-w-[1320px] px-5 py-16 lg:px-10 lg:py-20">
      <div className="grid gap-10 lg:grid-cols-[.85fr_1.15fr]"><div><SectionTitle eyebrow="A public process" title="Trust is built in the open." text="This portal keeps the important steps visible: what is approved, what is under review, and what residents can do next."/><ButtonLink href="/about" secondary>See how it works <ArrowRight size={15} /></ButtonLink></div>
        <div className="divide-y divide-[#e3e1d9] border-y border-[#e3e1d9]">
          {[
            [<FileText size={18} />, '01', 'Read approved documents', 'Review published governance documents and their exact versions.', '/documents'],
            [<UserRound size={18} />, '02', 'Apply for verification', 'Share your details securely so your residency can be reviewed.', '/membership'],
            [<BadgeCheck size={18} />, '03', 'Give informed consent', 'When a petition is configured, read its terms and version before signing.', '/petition'],
          ].map(([icon,num,title,text,href]) => <Link href={String(href)} key={String(num)} className="group flex gap-4 py-5 sm:gap-6"><span className="mt-1 text-[#477454]">{icon}</span><span className="w-8 pt-1 font-mono text-[11px] text-[#87918e]">{num}</span><span className="flex-1"><strong className="block text-[16px] font-semibold text-[#1b2c43]">{title}</strong><span className="mt-1 block text-sm leading-6 text-[#687486]">{text}</span></span><ArrowUpRight size={17} className="mt-1 text-[#89938f] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" /></Link>)}
        </div>
      </div>
    </section>
    <section className="bg-[#e9eee7]"><div className="mx-auto grid max-w-[1320px] gap-10 px-5 py-14 lg:grid-cols-[1fr_auto] lg:items-center lg:px-10"><div><Eyebrow>Membership verification</Eyebrow><h2 className="serif text-3xl font-bold tracking-[-.04em] text-[#182b43]">An application starts a review.</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-[#5d6a6c]">Residents are not automatically verified by applying. The association reviews each application before membership status is confirmed.</p></div><ButtonLink href="/membership">Start an application <ArrowRight size={15} /></ButtonLink></div></section>
    <section className="mx-auto grid max-w-[1320px] gap-8 px-5 py-16 lg:grid-cols-2 lg:px-10">
      <div><SectionTitle eyebrow="Public record" title="Only approved material." text="Documents and notices are sourced from the association's public record."/><Link href="/documents" className="inline-flex items-center gap-2 text-sm font-semibold text-[#315f43]">Browse documents <ArrowRight size={15} /></Link>
        <div className="mt-6 space-y-2">{docs.isLoading ? <Skeleton rows={2} /> : docs.isError ? <ErrorLine retry={() => docs.refetch()} /> : docs.data?.length ? docs.data.slice(0,2).map(d => <div key={d.id} className="flex items-center justify-between rounded-xl border border-[#e3e1d9] bg-white p-4"><div><p className="font-semibold text-[#22344b]">{d.title}</p><p className="mt-1 text-xs text-[#78828d]">{d.category} · Version {d.version}</p></div><FileText size={17} className="text-[#527b5c]" /></div>) : <EmptyPanel title="No approved documents published" text="When governance files are approved for public release, they will appear in the documents register." />}</div>
      </div>
      <div><SectionTitle eyebrow="Latest notices" title="What residents should know." text="Only published notices appear here. No dates or updates are assumed."/><Link href="/announcements" className="inline-flex items-center gap-2 text-sm font-semibold text-[#315f43]">All announcements <ArrowRight size={15} /></Link>
        <div className="mt-6 space-y-2">{announcements.isLoading ? <Skeleton rows={2} /> : announcements.isError ? <ErrorLine retry={() => announcements.refetch()} /> : announcements.data?.length ? announcements.data.slice(0,2).map(a => <div key={a.id} className="rounded-xl border border-[#e3e1d9] bg-white p-4"><p className="font-semibold text-[#22344b]">{a.title}</p><p className="mt-1 line-clamp-2 text-sm leading-6 text-[#687486]">{a.body}</p></div>) : <EmptyPanel title="No published notices" text="Public announcements will be shared here when ready." />}</div>
      </div>
    </section>
  </AppShell>;
}

function Skeleton({ rows = 3 }: { rows?: number }) { return <div className="space-y-3" aria-label="Loading"><span className="sr-only">Loading content</span>{Array.from({length:rows},(_,i)=><div key={i} className="h-[70px] animate-pulse rounded-xl bg-[#e9e7e0]" />)}</div>; }
function ErrorLine({ retry }: { retry: () => void }) { return <Notice kind="error">We could not load this information. <button onClick={retry} className="ml-1 font-semibold underline underline-offset-2">Try again</button></Notice>; }
function EmptyPanel({ title, text }: { title: string; text: string }) { return <div className="rounded-xl border border-dashed border-[#cfd5cd] bg-[#fbfaf6] px-5 py-6"><p className="text-sm font-semibold text-[#35485c]">{title}</p><p className="mt-1 text-sm leading-6 text-[#687486]">{text}</p></div>; }

function PublicPage({ path }: { path: string }) {
  const [title, description] = publicTitles[path] ?? ['Salama Park', 'Official association information.'];
  const docs = useGetPublicDocuments({ query: { queryKey: getGetPublicDocumentsQueryKey() } });
  const announcements = useGetPublicAnnouncements({ query: { queryKey: getGetPublicAnnouncementsQueryKey() } });
  const petition = useGetPublicPetition({ query: { queryKey: getGetPublicPetitionQueryKey() } });
  return <AppShell><div className="mx-auto max-w-[1160px] px-5 py-12 sm:py-16 lg:px-10">
    <div className="mb-10 max-w-3xl"><Eyebrow>Salama Park · Public information</Eyebrow><h1 className="serif text-[42px] font-bold leading-[1.05] tracking-[-.05em] text-[#172a43] sm:text-[56px]">{title}</h1><p className="mt-4 max-w-2xl text-[16px] leading-7 text-[#637083]">{description}</p></div>
    {path === '/about' && <div className="grid gap-8 md:grid-cols-[.8fr_1.2fr]"><div className="rounded-2xl bg-[#172b45] p-7 text-white"><Eyebrow inverse>What this portal is for</Eyebrow><p className="serif text-2xl font-semibold leading-snug">One dependable place for the steps that shape association governance.</p><p className="mt-4 text-sm leading-6 text-white/65">The portal distinguishes public information from private resident actions. Verification and future election processes follow formal association decisions.</p></div><div className="space-y-3">{[['01','Read','Approved documents and petition terms are available for residents to review.'],['02','Apply','Residents may submit an application for manual verification.'],['03','Participate','When enabled, eligible residents can provide consent against the exact published versions.'],['04','Follow','Notices, election status and results are published as they are formally confirmed.']].map(([n,h,t])=><div key={n} className="flex gap-5 rounded-xl border border-[#e2e0d9] bg-white p-5"><span className="font-mono text-xs text-[#477454]">{n}</span><div><h3 className="font-semibold text-[#1c2e44]">{h}</h3><p className="mt-1 text-sm leading-6 text-[#687486]">{t}</p></div></div>)}</div></div>}
    {path === '/documents' && <DocumentList docs={docs.data} loading={docs.isLoading} error={docs.isError} retry={() => docs.refetch()} />}
    {path === '/announcements' && <AnnouncementsList items={announcements.data} loading={announcements.isLoading} error={announcements.isError} retry={() => announcements.refetch()} />}
    {path === '/petition' && <div className="space-y-6"><PetitionDetails petition={petition.data} loading={petition.isLoading} error={petition.isError} retry={() => petition.refetch()} /><LivePoll /></div>}
    {path === '/membership' && <MembershipEntry />}
    {path === '/elections' && <EmptyPanel title="Election setup has not been published" text="Election timelines, eligibility and candidate information will appear here after formal configuration. No dates or candidates are currently being stated." />}
    {path === '/results' && <EmptyPanel title="No verified results published" text="This page will display results only after an election is completed and the results are formally verified and published." />}
    {path === '/privacy' && <PrivacyContent />}
    {path === '/faq' && <FaqContent />}
    {path === '/contact' && <EmptyPanel title="Contact information is not yet published" text="The association's official contact channels will be added here once confirmed. No contact details are being assumed." />}
    <div className="mt-10 border-t border-[#e1dfd8] pt-6 text-xs text-[#78828d]">Information is presented as published by the association. Unconfigured items are clearly marked.</div>
  </div></AppShell>;
}

function DocumentList({ docs, loading, error, retry }: { docs?: any[]; loading: boolean; error: boolean; retry: () => void }) {
  if (loading) return <Skeleton />;
  if (error) return <ErrorLine retry={retry} />;
  if (!docs?.length) return <EmptyPanel title="No approved governance files are published yet" text="This register will show approved files only. Draft or unapproved materials are not presented as official documents." />;
  return <div className="space-y-3">{docs.map(doc => <article key={doc.id} className="flex flex-col gap-4 rounded-2xl border border-[#e1dfd8] bg-white p-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-4"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#eaf1e8] text-[#477454]"><FileText size={20} /></span><div><h2 className="font-semibold text-[#1c2e44]">{doc.title}</h2><p className="mt-1 text-xs text-[#78828d]">{doc.category} <span className="px-1">·</span> Version {doc.version}{doc.publishedAt ? ` · Published ${new Date(doc.publishedAt).toLocaleDateString()}` : ''}</p><p className="mt-2 text-sm leading-6 text-[#687486]">{doc.description}</p></div></div>{doc.downloadUrl ? <a href={doc.downloadUrl} target="_blank" rel="noreferrer" className="btn-secondary shrink-0">Open document <ArrowUpRight size={15} /></a> : <span className="self-start rounded-lg bg-[#f0efe9] px-3 py-2 text-xs text-[#707b86]">Download unavailable</span>}</article>)}</div>;
}
function AnnouncementsList({ items, loading, error, retry }: { items?: any[]; loading: boolean; error: boolean; retry: () => void }) {
  if (loading) return <Skeleton />;
  if (error) return <ErrorLine retry={retry} />;
  if (!items?.length) return <EmptyPanel title="No published notices" text="Association updates will appear here after they are formally published." />;
  return <div className="grid gap-3">{items.map(item=><article key={item.id} className="rounded-2xl border border-[#e1dfd8] bg-white p-6"><div className="flex items-start justify-between gap-4"><h2 className="serif text-xl font-bold text-[#1c2e44]">{item.title}</h2><time className="shrink-0 pt-1 text-xs text-[#78828d]">{new Date(item.publishedAt).toLocaleDateString()}</time></div><p className="mt-3 whitespace-pre-line text-sm leading-7 text-[#606e81]">{item.body}</p></article>)}</div>;
}
function PetitionDetails({ petition, loading, error, retry }: { petition?: any; loading: boolean; error: boolean; retry: () => void }) {
  if (loading) return <Skeleton rows={2} />;
  if (error) return <ErrorLine retry={retry} />;
  if (!petition || petition.status === 'not-configured') return <EmptyPanel title="Petition not configured" text="No approved constitution or petition version is currently available. Signing is unavailable until the association publishes the exact documents, eligibility terms and petition configuration." />;
  const basePath = (import.meta as any).env?.BASE_PATH || '/';
  const docUrl = `${basePath.replace(/\/$/, '')}/documents/salama-park-petition-for-adoption-of-draft-constitution.pdf`;
  return <div className="grid gap-6 lg:grid-cols-[1fr_340px]"><div className="space-y-5"><div className="rounded-2xl border border-[#e1dfd8] bg-white p-6"><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#477454]"><span className="size-2 rounded-full bg-[#6a9c71]" />{petition.status}</div><h2 className="serif mt-3 text-2xl font-bold text-[#192d45]">Petition information</h2><p className="mt-3 text-sm leading-7 text-[#647083]">{petition.eligibilityText || 'Eligibility terms have not been published.'}</p>
    <div className="mt-4 rounded-xl border border-[#e1dfd8] bg-[#f7f7f4] p-4">
      <h3 className="font-semibold text-[#192d45]">Petition summary</h3>
      <p className="mt-2 text-sm leading-6 text-[#647083]">This petition seeks adoption of the entire Draft Constitution (including Article 15 on Transitional and Founding Provisions), establishment of a new register of members from verified membership applications, and online voting for adoption and first elections. No subscription is required during the founding period; the monthly subscription poll is part of the membership application.</p>
      <ul className="mt-2 list-disc pl-5 text-sm leading-6 text-[#647083]">
        <li>Threshold: 2/3 of members on the register for adoption</li>
        <li>Quorum: 25% for considering the Constitution</li>
        <li>Verification by independent Returning Officer with two scrutineers</li>
        <li>Online voting with secret ballot, receipt codes, and verifiability</li>
      </ul>
      <a href={docUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-[#315f43]">Read full petition details <ArrowUpRight size={15} /></a>
    </div>
    <div className="mt-6 grid gap-4 border-t border-[#e8e6df] pt-5 sm:grid-cols-2"><VersionField label="Constitution version" value={petition.constitutionVersion} /><VersionField label="Petition version" value={petition.petitionVersion} /><VersionField label="Opening date" value={petition.openingDate ? new Date(petition.openingDate).toLocaleDateString() : null} /><VersionField label="Closing date" value={petition.closingDate ? new Date(petition.closingDate).toLocaleDateString() : null} /></div></div><Notice>Submitting consent records a declaration against the exact published versions. Review every term before continuing.</Notice></div><div className="rounded-2xl bg-[#172b45] p-6 text-white"><Eyebrow inverse>Signing status</Eyebrow><h3 className="serif text-2xl font-bold">{petition.signingEnabled ? 'Signing is enabled' : 'Signing unavailable'}</h3><p className="mt-3 text-sm leading-6 text-white/65">{petition.signingEnabled ? 'Sign-in and resident eligibility are required before submitting a declaration.' : 'The association has not enabled signing for this petition.'}</p><ButtonLink href="/login" secondary>Resident sign in <ArrowRight size={15} /></ButtonLink></div></div>;
}
function VersionField({ label, value }: { label: string; value: string | null }) { return <div><p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#87918e]">{label}</p><p className="mt-1 text-sm font-semibold text-[#293c52]">{value || 'Not published'}</p></div>; }
function MembershipEntry() { return <div className="grid gap-5 md:grid-cols-2"><div className="rounded-2xl bg-[#172b45] p-7 text-white"><UserRound className="mb-5 text-[#a8c8a6]" size={22} /><h2 className="serif text-2xl font-bold">Begin with your resident account.</h2><p className="mt-3 text-sm leading-6 text-white/65">Sign in or create an account to securely complete the membership application. Your application will be reviewed; it is not an automatic membership confirmation.</p><div className="mt-6 flex flex-wrap gap-3"><ButtonLink href="/register">Create account <ArrowRight size={15} /></ButtonLink><ButtonLink href="/login" secondary>Sign in</ButtonLink></div></div><div className="rounded-2xl border border-[#e1dfd8] bg-white p-7"><Eyebrow>What happens next</Eyebrow><div className="space-y-5">{[['Provide details','Tell us how to identify and reach you.'],['Association review','Your residency and details are reviewed separately.'],['Status update','Check your private portal for an application status or request for clarification.']].map(([h,t],i)=><div key={h} className="flex gap-4"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#edf2ea] font-mono text-xs text-[#477454]">{i+1}</span><div><p className="text-sm font-semibold text-[#263950]">{h}</p><p className="mt-1 text-sm leading-6 text-[#6a7686]">{t}</p></div></div>)}</div></div></div>; }
function PrivacyContent() { return <div className="max-w-3xl space-y-4"><Notice>By submitting a resident application, you must acknowledge the privacy notice. Only provide information you are comfortable sharing for verification.</Notice><article className="prose prose-slate max-w-none rounded-2xl border border-[#e1dfd8] bg-white p-6 text-sm leading-7 text-[#5f6d80]"><h2 className="serif text-xl font-bold text-[#192d45]">Information collected</h2><p>The application follows the association's registration record (Sections A–E, and Section G where it applies). It collects your name, NRC or passport number, date of birth, gender, nationality, contact details, Salama Park address and plot number, residency and household details, your subscription poll choice, and your declarations and digital signature. Optional planning questions in Section H and the emergency contact details are collected only if you choose to provide them.</p><h2 className="serif text-xl font-bold text-[#192d45]">How information is used</h2><p>Identity and residency details are used to verify your application and to maintain the members register and voter roll. Aggregate subscription poll results are published without your name. Section F verification notes are recorded by authorized association officials only. Application information is not public, and a submission is not proof of verified membership.</p><h2 className="serif text-xl font-bold text-[#192d45]">Your choices</h2><p>Provide only accurate information. Declarations in Section E and consent to contact are required to submit an application; the optional planning questions are never used to exclude anyone. Email notifications are recorded as a preference but delivery is not yet connected; SMS is not available yet.</p><p className="text-xs text-[#7c8791]">This notice describes the portal's application flow. Association contact details and any further approved policy will be added when available.</p></article></div>; }
function FaqContent() { const qa = [['Does applying make me a verified member?','No. An application begins a review. Membership is confirmed only after the association verifies the application.'],['Are the constitution or petition already approved?','Only files shown in the public documents register are presented as approved. The uploaded background brief is not an approved draft constitution or petition.'],['Can I sign the petition now?','Signing depends on an active, configured petition, published document versions and eligibility settings. The petition page shows the current status.'],['When will elections take place?','No election date is stated unless the association formally configures and publishes one. Check the Elections page for confirmed information.'],['Where are results published?','Verified results will be made available on the public Results page after they are formally published.'],['How can I contact the association?','Official contact details have not been published in this portal yet. The Contact page will be updated once confirmed.']]; return <div className="max-w-3xl space-y-3">{qa.map(([q,a])=><details key={q} className="group rounded-xl border border-[#e1dfd8] bg-white px-5 py-4"><summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-[#263950]">{q}<ChevronDown size={17} className="shrink-0 text-[#527b5c] transition-transform group-open:rotate-180" /></summary><p className="mt-3 max-w-2xl text-sm leading-6 text-[#687486]">{a}</p></details>)}</div>; }

function LoginRoute() { return <Redirect to="/sign-in" />; }
function RegisterRoute() { return <Redirect to="/sign-up" />; }
function SignInPage() { return <div className="topo flex min-h-[calc(100dvh-50px)] items-center justify-center px-4 py-10"><div className="w-full max-w-[440px]"><div className="mb-6 text-center"><div className="mb-5 flex justify-center"><Brand inverse /></div><p className="text-sm text-white/70">Secure access for Salama Park residents</p></div><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></div></div>; }
function SignUpPage() { return <div className="topo flex min-h-[calc(100dvh-50px)] items-center justify-center px-4 py-10"><div className="w-full max-w-[440px]"><div className="mb-6 text-center"><div className="mb-5 flex justify-center"><Brand inverse /></div><p className="text-sm text-white/70">Create an account to access resident services</p></div><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></div></div>; }
function AuthSupport({ path }: { path: string }) { const forgot = path === '/forgot-password'; return <div className="topo flex min-h-[70vh] items-center justify-center px-5 py-12"><div className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#fbfaf5] p-7 sm:p-10"><Brand /><div className="mt-8"><Eyebrow>{forgot ? 'Account recovery' : 'Email verification'}</Eyebrow><h1 className="serif text-3xl font-bold tracking-tight text-[#192d45]">{forgot ? 'Reset your password securely.' : 'Verify your account.'}</h1><p className="mt-3 text-sm leading-6 text-[#687486]">{forgot ? 'Continue through Clerk’s secure recovery flow to reset your password.' : 'Account verification is handled securely by Clerk. Complete any verification prompt shown during sign-up or sign-in.'}</p><ButtonLink href={forgot ? '/sign-in' : '/sign-up'}>{forgot ? 'Continue to sign in' : 'Continue to account creation'} <ArrowRight size={15} /></ButtonLink></div></div></div>; }

function Protected({ children }: { children: ReactNode }) { return <><Show when="signed-in">{children}</Show><Show when="signed-out"><div className="mx-auto max-w-3xl px-5 py-20"><div className="rounded-2xl border border-[#e1dfd8] bg-white p-8 text-center"><LockKeyhole className="mx-auto mb-4 text-[#477454]" size={26} /><h1 className="serif text-3xl font-bold text-[#192d45]">Sign in to continue.</h1><p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[#687486]">Resident information and private actions are only available to signed-in users. An account does not itself establish verified membership.</p><div className="mt-6 flex justify-center gap-3"><ButtonLink href="/login">Sign in <ArrowRight size={15} /></ButtonLink><ButtonLink href="/register" secondary>Create account</ButtonLink></div></div></div></Show></>; }
function ResidentLayout({ children, heading, description }: { children: ReactNode; heading: string; description: string }) { return <Protected><AppShell><div className="mx-auto max-w-[1320px] px-5 py-10 lg:px-10"><div className="mb-8 flex flex-col gap-6 border-b border-[#e1dfd8] pb-7 lg:flex-row lg:items-end lg:justify-between"><div><Eyebrow>Resident portal</Eyebrow><h1 className="serif text-4xl font-bold tracking-[-.045em] text-[#192d45]">{heading}</h1><p className="mt-2 text-sm text-[#687486]">{description}</p></div><nav className="flex gap-1 overflow-x-auto pb-1">{residentNav.map(([label,href])=><Link key={href} href={href} className="whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold text-[#47566a] hover:bg-[#e9eee7]">{label}</Link>)}</nav></div>{children}</div></AppShell></Protected>; }
function ApplicationPage() {
  const queryClient = useQueryClient();
  const { isSignedIn } = useUser();
  const appQuery = useGetMyResidentApplication({ query: { enabled: isSignedIn, queryKey: getGetMyResidentApplicationQueryKey() } });
  const submit = useSubmitResidentApplication();
  const [localError, setLocalError] = useState('');
  const onSubmit = (payload: ResidentApplicationInput) => {
    setLocalError('');
    submit.mutate({data: payload}, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetMyResidentApplicationQueryKey() }); }, onError: (error) => setLocalError(serverErrorMessage(error, 'Your application could not be submitted. Please try again.')) });
  };
  const application = appQuery.data?.application;
  return <ResidentLayout heading="Membership application" description="Complete the association's registration form for review."><div className="grid gap-7 lg:grid-cols-[1fr_320px]"><div>
    {appQuery.isLoading ? <Skeleton rows={2} /> : appQuery.isError ? <ErrorLine retry={() => appQuery.refetch()} /> : application ? <div className="mb-6 rounded-2xl border border-[#dce5db] bg-[#f1f5ef] p-5"><div className="flex items-center gap-2 text-sm font-semibold text-[#315f43]"><BadgeCheck size={17} />Application received · {application.status}</div><p className="mt-2 text-sm text-[#657184]">Reference {application.reference}. Your application is not an automatic membership verification.</p>{application.subscriptionVote && <p className="mt-1 text-sm text-[#657184]">Subscription choice recorded: {application.subscriptionVote.toUpperCase()} per month.</p>}</div> : null}
    {!application && <div>
      <div className="mb-5 rounded-2xl border border-[#e1dfd8] bg-white p-6"><h2 className="serif text-2xl font-bold text-[#1d3048]">Registration form</h2><p className="mt-2 text-sm leading-6 text-[#687486]">This form follows the association's registration record (Sections A–H). Required fields must be completed. Optional planning questions are never used to exclude anyone.</p></div>
      <RegistrationForm isPending={submit.isPending} onSubmit={onSubmit} />
      {localError && <div className="mt-4"><Notice kind="error">{localError}</Notice></div>}
      {submit.isSuccess && <div className="mt-4"><Notice kind="success">Application submitted. It is now awaiting association review.</Notice></div>}
    </div>}
  </div><aside className="space-y-4"><div className="rounded-2xl bg-[#172b45] p-6 text-white"><Eyebrow inverse>Important</Eyebrow><h3 className="serif text-xl font-bold">Application is not approval.</h3><p className="mt-3 text-sm leading-6 text-white/65">An association reviewer must verify your information. Keep your reference for future correspondence.</p></div><Link href="/privacy" className="flex items-center justify-between rounded-xl border border-[#e1dfd8] bg-white p-4 text-sm font-semibold text-[#35485c]">Read privacy notice <ArrowUpRight size={16} /></Link></aside></div></ResidentLayout>;
}
const residentCopy: Record<string, [string, string]> = {
  '/resident/dashboard': ['Your resident portal', 'Your association actions and current application status.'],
  '/resident/profile': ['My profile', 'Account details from your signed-in profile.'],
  '/resident/application': ['Membership application', "Complete the association's registration form for review."],
  '/resident/petition': ['Petition consent', 'Review the published versions before any declaration.'],
  '/resident/voting': ['Voting', 'Election eligibility and voting access.'],
  '/resident/receipts': ['Private receipts', 'Your submitted application and consent receipts.'],
  '/resident/notifications': ['Notifications', 'Association messages and your notification preferences.'],
};

/**
 * Heading and description for a resident page.
 *
 * Every entry in the resident route list must exist here: a missing key used to
 * make this destructuring throw, which the error boundary turned into
 * "Something went wrong" for the whole page.
 */
function residentPageCopy(path: string): [string, string] {
  return residentCopy[path] ?? ["Your resident portal", 'Your association actions and current status.'];
}

function ResidentPage({ path }: { path: string }) {
  const [heading, description] = residentPageCopy(path);
  const queryClient = useQueryClient();
  const { isSignedIn } = useUser();
  const app = useGetMyResidentApplication({ query: { enabled: isSignedIn, queryKey: getGetMyResidentApplicationQueryKey() } });
  const petition = useGetPublicPetition({ query: { queryKey: getGetPublicPetitionQueryKey() } });
  const receipts = useGetMyPetitionReceipts({ query: { enabled: isSignedIn, queryKey: getGetMyPetitionReceiptsQueryKey() } });
  const receiptMutation = useSubmitPetitionConsent();
  const withdrawMutation = useWithdrawMyPetitionSignature();
  const [receipt, setReceipt] = useState<{
    reference: string;
    constitutionVersion: string;
    petitionVersion: string;
    subscriptionVote?: string | null;
    submittedAt: Date | string;
  } | null>(null);
  const [error, setError] = useState('');
  if (path === '/resident/application') return <ApplicationPage />;
  if (path === '/resident/petition') {
    const active = petition.data?.signingEnabled && petition.data?.constitutionVersion && petition.data?.petitionVersion;
    const isVerified = app.data?.application?.status === 'verified';
    const matchingReceipt = receipts.data?.find(item =>
      item.status === 'accepted' &&
      item.constitutionVersion === petition.data?.constitutionVersion &&
      item.petitionVersion === petition.data?.petitionVersion,
    );
    const onConsent = (payload: PetitionPayload) => {
      setError('');
      receiptMutation.mutate({ data: payload }, {
        onSuccess: result => {
          setReceipt(result);
          queryClient.invalidateQueries({ queryKey: getGetMyPetitionReceiptsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetPublicOverviewQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetPublicPollResultsQueryKey() });
        },
        onError: apiError => setError(serverErrorMessage(apiError, 'Consent could not be recorded. Please try again.')),
      });
    };
    const onWithdraw = () => {
      if (!window.confirm('Withdraw your active petition signature? This cannot be undone after the published closing deadline.')) return;
      setError('');
      withdrawMutation.mutate(undefined, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetMyPetitionReceiptsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetPublicOverviewQueryKey() });
        },
        onError: apiError => setError(serverErrorMessage(apiError, 'The signature could not be withdrawn. Please try again.')),
      });
    };
    return <ResidentLayout heading={heading} description={description}><div className="max-w-3xl">
      {petition.isLoading ? <Skeleton rows={2} /> : petition.isError ? <ErrorLine retry={()=>petition.refetch()} /> : <PetitionDetails petition={petition.data} loading={false} error={false} retry={()=>petition.refetch()} />}
      {receipt && <div className="mt-5"><Notice kind="success">Declaration received. Receipt {receipt.reference} · Constitution {receipt.constitutionVersion} · Petition {receipt.petitionVersion}</Notice></div>}
      {active && !isVerified && <div className="mt-5"><Notice>Your application must be verified before you can sign this petition. <Link href="/resident/application" className="font-semibold underline">Check application status</Link>.</Notice></div>}
      {active && isVerified && !matchingReceipt && <div className="mt-5">
        <PetitionConsentForm isPending={receiptMutation.isPending} onSubmit={onConsent} />
      </div>}
      {matchingReceipt && petition.data?.signingEnabled && <div className="mt-5 rounded-2xl border border-[#e1dfd8] bg-white p-5">
        <p className="font-semibold text-[#1b2e45]">Active signature · Receipt {matchingReceipt.reference}</p>
        <p className="mt-2 text-sm text-[#687486]">Your declaration is recorded for Constitution {matchingReceipt.constitutionVersion} and petition {matchingReceipt.petitionVersion}. This receipt covers the constitution-adoption declaration only; residence, subscription and household details are held in your membership application.</p>
        <button type="button" onClick={onWithdraw} disabled={withdrawMutation.isPending} className="btn-secondary mt-4 disabled:opacity-50">{withdrawMutation.isPending ? 'Withdrawing…' : 'Withdraw signature'}</button>
      </div>}
      {error && !matchingReceipt && <div className="mt-3"><Notice kind="error">{error}</Notice></div>}
      {receipts.isError && <div className="mt-4"><ErrorLine retry={()=>receipts.refetch()} /></div>}
    </div></ResidentLayout>;
  }
  if (path === '/resident/dashboard') return <ResidentLayout heading={heading} description={description}><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><ResidentCard href="/resident/application" icon={<ClipboardCheck size={19}/>} title="Membership application" text={app.data?.application ? `Status: ${app.data.application.status}` : 'Complete an application for review.'}/><ResidentCard href="/resident/petition" icon={<FileText size={19}/>} title="Petition consent" text="Review the active petition and exact versions."/><ResidentCard href="/resident/receipts" icon={<BadgeCheck size={19}/>} title="Receipts" text="Review receipts from your resident actions."/></div><div className="mt-6">{app.isLoading ? <Skeleton rows={1}/> : app.isError ? <ErrorLine retry={()=>app.refetch()}/> : app.data?.application ? <Notice>Your application is <strong>{app.data.application.status}</strong>. A submitted application does not mean membership has been verified.</Notice> : <Notice>You have not submitted a membership application yet. Begin when you are ready.</Notice>}</div></ResidentLayout>;
  if (path === '/resident/profile') return <ResidentLayout heading={heading} description={description}><ProfileView /></ResidentLayout>;
  if (path === '/resident/voting') return <ResidentLayout heading={heading} description={description}><EmptyPanel title="Voting is not configured" text="No election, candidate list or voting window has been formally published. Eligibility and voting actions will appear when configured." /></ResidentLayout>;
  if (path === '/resident/receipts') return <ResidentLayout heading={heading} description={description}><div className="grid gap-4 md:grid-cols-2">
    <div><h2 className="mb-3 text-sm font-bold text-[#273a51]">Membership application</h2>{app.isLoading ? <Skeleton rows={1}/> : app.isError ? <ErrorLine retry={()=>app.refetch()}/> : app.data?.application ? <div className="rounded-xl border border-[#e1dfd8] bg-white p-5"><p className="font-semibold text-[#1b2e45]">Application {app.data.application.reference}</p><p className="mt-2 text-sm text-[#687486]">Status: {app.data.application.status}</p><p className="mt-1 text-xs text-[#87918e]">Submitted {new Date(app.data.application.submittedAt).toLocaleDateString()}</p></div> : <EmptyPanel title="No application receipt" text="Once you submit an application, its status and reference appear here." />}</div>
    <div><h2 className="mb-3 text-sm font-bold text-[#273a51]">Petition declarations</h2>{receipts.isLoading ? <Skeleton rows={1}/> : receipts.isError ? <ErrorLine retry={()=>receipts.refetch()}/> : receipts.data?.length ? <div className="space-y-3">{receipts.data.map(item=><div key={item.reference} className="rounded-xl border border-[#e1dfd8] bg-white p-5"><p className="font-semibold text-[#1b2e45]">Receipt {item.reference}</p><p className="mt-2 text-sm text-[#687486]">Constitution {item.constitutionVersion} · Petition {item.petitionVersion}</p><p className="mt-1 text-xs text-[#87918e]">{item.status} · Submitted {new Date(item.submittedAt).toLocaleDateString()}</p></div>)}</div> : <EmptyPanel title="No petition receipts" text="A private receipt appears here after your declaration is recorded." />}</div>
  </div></ResidentLayout>;
  if (path === '/resident/notifications') return <ResidentLayout heading={heading} description={description}><EmptyPanel title="No notifications yet" text="Published association notices and private status updates will appear here when available." /></ResidentLayout>;
  return <ResidentLayout heading={heading} description={description}><ProfileView /></ResidentLayout>;
}
function LivePoll() {
  const poll = useGetPublicPollResults({ query: { queryKey: getGetPublicPollResultsQueryKey() } });
  if (poll.isLoading) return <Skeleton rows={1} />;
  if (poll.isError) return <ErrorLine retry={() => poll.refetch()} />;
  const data = poll.data;
  if (!data || data.totalVotes === 0) {
    return <EmptyPanel title="No subscription votes yet" text="The monthly subscription poll opens as soon as residents begin registering. Results update live." />;
  }
  const options = [
    { key: 'k50', label: 'K50.00', votes: data.votesK50, pct: data.percentageK50 },
    { key: 'k100', label: 'K100.00', votes: data.votesK100, pct: data.percentageK100 },
    { key: 'k150', label: 'K150.00', votes: data.votesK150, pct: data.percentageK150 },
  ] as const;
  const winner = options.find(o => o.key === data.currentWinner);
  return <div className="rounded-2xl border border-[#e1dfd8] bg-white p-6">
    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#477454]"><span className="size-2 animate-pulse rounded-full bg-[#6a9c71]" />Live subscription poll</div>
    <h3 className="serif mt-3 text-2xl font-bold text-[#192d45]">Monthly subscription</h3>
    <p className="mt-2 text-sm leading-6 text-[#647083]">Residents choose the amount they are willing to commit each month. {winner ? <><strong>{winner.label}</strong> currently leads with {winner.pct}% of {data.totalVotes} votes.</> : <>It is currently a tie across {data.totalVotes} votes.</>}</p>
    <div className="mt-5 space-y-4">
      {options.map(option => <div key={option.key}>
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-semibold text-[#263950]">{option.label}</span>
          <span className="text-[#687486]">{option.votes} votes · {option.pct}%</span>
        </div>
        <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-[#eceee9]">
          <div className={`h-full rounded-full ${option.key === data.currentWinner ? 'bg-[#315f43]' : 'bg-[#9dbba1]'}`} style={{ width: `${option.pct}%` }} />
        </div>
      </div>)}
    </div>
    <div className="mt-6 grid grid-cols-2 gap-3 border-t border-[#e8e6df] pt-5 sm:grid-cols-4">
      {[['Households', data.totalVotes], ['Homeowners', data.homeowners], ['Tenants', data.tenants], ['Volunteers', data.volunteers]].map(([label, value]) => <div key={String(label)}><p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#87918e]">{label}</p><p className="mt-1 text-lg font-semibold text-[#293c52]">{value}</p></div>)}
    </div>
  </div>;
}

const PETITION_DECLARATIONS = [
  ['readConstitution', 'I have read the published Constitution and the petition for its adoption.'],
  ['consentToVersion', 'I consent to this declaration being recorded against the exact published versions shown.'],
  ['truthfulResidency', 'I confirm that my residency information is true.'],
  ['understandDataUse', 'I understand how my information is used in the members register and voter roll.'],
  ['understandFoundingProvisions', 'I understand the founding provisions in Article 15 of the draft Constitution.'],
  ['understandWithdrawal', 'I understand that I may withdraw my signature before the published closing deadline.'],
  ['voluntary', 'I give this declaration voluntarily.'],
] as const;

type PetitionPayload = {
  readConstitution: boolean;
  consentToVersion: boolean;
  truthfulResidency: boolean;
  understandDataUse: boolean;
  understandFoundingProvisions: boolean;
  understandWithdrawal: boolean;
  voluntary: boolean;
};

function PetitionConsentForm({ isPending, onSubmit }: { isPending: boolean; onSubmit: (data: PetitionPayload) => void }) {
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});

  const valid = PETITION_DECLARATIONS.every(([key]) => confirmed[key] === true);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    onSubmit({
      readConstitution: true,
      consentToVersion: true,
      truthfulResidency: true,
      understandDataUse: true,
      understandFoundingProvisions: true,
      understandWithdrawal: true,
      voluntary: true,
    });
  };

  return <form onSubmit={handleSubmit} className="mt-5 space-y-5">
    <div className="rounded-2xl border border-[#e1dfd8] bg-white p-6">
      <h3 className="font-semibold text-[#1b2e45]">Declaration of consent</h3>
      <p className="mt-2 text-sm leading-6 text-[#657184]">This petition seeks adoption of the Draft Constitution. Confirm each declaration before recording your signature. Subscription choices and household details are collected during registration, not here.</p>
      <div className="mt-4 space-y-3">
        {PETITION_DECLARATIONS.map(([key, text]) => <label key={key} className="flex items-start gap-3 text-sm leading-6 text-[#536174]">
          <input type="checkbox" className="mt-1 accent-[#315f43]" checked={confirmed[key] === true} onChange={event => setConfirmed(current => ({ ...current, [key]: event.target.checked }))} />
          {text}
        </label>)}
      </div>
    </div>
    <button type="submit" disabled={!valid || isPending} className="btn-primary disabled:opacity-50">{isPending ? 'Recording…' : 'Submit declaration'} <ArrowRight size={15} /></button>
  </form>;
}


function ResidentCard({href,icon,title,text}:{href:string;icon:ReactNode;title:string;text:string}) { return <Link href={href} className="group rounded-2xl border border-[#e1dfd8] bg-white p-5 transition-colors hover:border-[#b8c9b7]"><span className="grid size-10 place-items-center rounded-xl bg-[#eaf1e8] text-[#477454]">{icon}</span><h2 className="mt-4 font-semibold text-[#1c2e44]">{title}</h2><p className="mt-1 text-sm leading-6 text-[#687486]">{text}</p><span className="mt-4 flex items-center gap-2 text-xs font-semibold text-[#477454]">Open <ArrowRight size={13}/></span></Link>; }
function ProfileView() { const {user,isLoaded}=useUser(); if(!isLoaded) return <Skeleton rows={1}/>; return <div className="max-w-2xl rounded-2xl border border-[#e1dfd8] bg-white p-6"><div className="flex items-center gap-4"><span className="grid size-12 place-items-center rounded-full bg-[#eaf1e8] text-[#477454]"><UserRound size={22}/></span><div><p className="font-semibold text-[#1c2e44]">{user?.fullName || 'Resident account'}</p><p className="text-sm text-[#687486]">{user?.primaryEmailAddress?.emailAddress || 'Email not available'}</p></div></div><div className="mt-6 border-t border-[#e8e6df] pt-5"><Notice>Your account profile is separate from association verification. Verified membership status is determined by the association review process.</Notice></div></div>; }

function AdminPage({path}:{path:string}) {
  const title=adminCopy[path]||'Administration';
  const {isSignedIn}=useUser();
  const queryClient=useQueryClient();
  const access=useGetAdminAccess({query:{enabled:isSignedIn,queryKey:getGetAdminAccessQueryKey()}});
  const isManagementPage=path==='/admin/members'||path==='/admin/verifications';
  const isReviewer=access.data?.role==='admin'||access.data?.role==='administrator'||access.data?.role==='returning-officer';
  const isAdmin=access.data?.role==='admin'||access.data?.role==='administrator';
  return <Protected><Show when="signed-in"><AppShell>
    {access.isLoading?<div className="mx-auto max-w-3xl px-5 py-16"><Skeleton rows={2}/></div>
    :access.isError?<div className="mx-auto max-w-3xl px-5 py-16"><ErrorLine retry={()=>access.refetch()}/></div>
    :!access.data?.allowed?<div className="mx-auto max-w-3xl px-5 py-20"><div className="rounded-2xl border border-[#e1dfd8] bg-white p-8 text-center"><LockKeyhole className="mx-auto mb-4 text-[#477454]" size={26}/><h1 className="serif text-3xl font-bold text-[#192d45]">Association official access required.</h1><p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-[#687486]">Your account is signed in but has no association role. Roles are assigned separately; signing in does not grant access to resident records.</p><div className="mt-6 flex justify-center"><ButtonLink href="/resident/dashboard">Return to resident portal <ArrowRight size={15}/></ButtonLink></div></div></div>
    :<div className="mx-auto max-w-[1320px] px-5 py-10 lg:px-10">
      <div className="mb-8"><Eyebrow>Association administration</Eyebrow><h1 className="serif text-4xl font-bold tracking-[-.045em] text-[#192d45]">{title}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-[#687486]">Access is checked by the server for each protected operation. The portal does not expose ballot selections.</p></div>
      <div className="grid gap-8 lg:grid-cols-[230px_1fr]">
        <nav className="grid grid-cols-2 gap-1 rounded-xl border border-[#e1dfd8] bg-white p-3 sm:grid-cols-3 lg:block">{adminNav.map(([label,href])=><Link key={href} href={href} className={`block rounded-lg px-3 py-2.5 text-xs font-semibold ${href===path?'bg-[#eaf1e8] text-[#315f43]':'text-[#596778] hover:bg-[#f4f3ed]'}`}>{label}</Link>)}</nav>
        <div className="min-w-0">
          {path==='/admin/dashboard' ? <AdminDashboard/>
          :path==='/admin/verifications' ? <AdminPetitionPanel canReview={isReviewer} onChanged={()=>{queryClient.invalidateQueries({queryKey:getGetAdminDashboardQueryKey()});queryClient.invalidateQueries({queryKey:getGetPublicPollResultsQueryKey()});}}/>
          :path==='/admin/petitions' ? <AdminPetitionConfigurationPanel canReview={isReviewer} onChanged={()=>{queryClient.invalidateQueries({queryKey:getGetAdminDashboardQueryKey()});queryClient.invalidateQueries({queryKey:getGetPublicPetitionQueryKey()});queryClient.invalidateQueries({queryKey:getGetPublicOverviewQueryKey()});}}/>
          :path==='/admin/register-snapshots' ? <AdminRegisterSnapshotsPanel onChanged={()=>{queryClient.invalidateQueries({queryKey:getGetAdminDashboardQueryKey()});queryClient.invalidateQueries({queryKey:getGetPublicOverviewQueryKey()});}}/>
          :path==='/admin/settings' ? <AdminRolesPanel isAdmin={isAdmin}/>
          :isManagementPage ? <AdminApplicationsPanel canReview={isReviewer} onChanged={()=>{queryClient.invalidateQueries({queryKey:getGetAdminDashboardQueryKey()});}}/>
          :<div className="rounded-2xl border border-dashed border-[#cfd5cd] bg-[#fbfaf6] p-6 sm:p-8"><div className="mb-4 grid size-11 place-items-center rounded-xl bg-[#eaf1e8] text-[#477454]"><LockKeyhole size={20}/></div><h2 className="serif text-2xl font-bold text-[#1d3048]">This workflow is not configured.</h2><p className="mt-2 max-w-xl text-sm leading-6 text-[#687486]">No approved official records are available for this page. Configuration and publishing actions are not enabled until the Association supplies and approves the required rules and source documents.</p><div className="mt-5 flex flex-wrap gap-3"><Link href="/documents" className="btn-secondary">View public documents <ArrowUpRight size={14}/></Link><Link href="/announcements" className="btn-secondary">Public notices <ArrowUpRight size={14}/></Link></div></div>}
        </div>
      </div>
    </div>}
  </AppShell></Show></Protected>;
}

function AdminDashboard() {
  const dashboard=useGetAdminDashboard({query:{queryKey:getGetAdminDashboardQueryKey()}});
  if(dashboard.isLoading)return <Skeleton rows={3}/>;
  if(dashboard.isError)return <ErrorLine retry={()=>dashboard.refetch()}/>;
  const data=dashboard.data;
  if(!data)return <EmptyPanel title="No dashboard data" text="Refresh to request the latest administrative totals."/>;
  const rows=[
    ['All applications',data.totalApplications],
    ['Pending verification',data.pendingApplications],
    ['Clarification requested',data.clarificationRequested],
    ['Verified applications',data.verifiedApplications],
    ['Rejected applications',data.rejectedApplications],
    ['Accepted petition signatures',data.acceptedPetitionSignatures],
    ['Unverified signatures',data.unverifiedSignatures],
    ['Duplicate flags',data.duplicateFlags],
  ];
  const pollRows=[
    ['Total subscription votes',data.totalVotes],
    ['K50 votes',data.votesK50],
    ['K100 votes',data.votesK100],
    ['K150 votes',data.votesK150],
    ['Homeowners',data.homeowners],
    ['Tenants',data.tenants],
    ['Volunteers',data.volunteers],
    ['Consented to online voting',data.onlineVotingConsent],
  ];
  const winner=data.currentWinner?data.currentWinner.toUpperCase():null;
  return <div>
    <div className="mb-5 rounded-xl border border-[#e1dfd8] bg-white p-5"><p className="text-xs font-bold uppercase tracking-wider text-[#647083]">Petition status</p><p className="mt-2 text-lg font-semibold capitalize text-[#1c2e44]">{data.petitionStatus.replaceAll('-',' ')}</p><p className="mt-2 text-sm text-[#687486]">Verified register denominator: {data.verifiedDenominator??'not established'}{winner?` · Subscription leading option: ${winner}`:''}</p></div>
    <p className="mb-2 mt-6 text-xs font-bold uppercase tracking-wider text-[#647083]">Membership &amp; signatures</p>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{rows.map(([label,value])=><div key={label} className="rounded-xl border border-[#e1dfd8] bg-white p-5"><p className="text-xs font-semibold text-[#738090]">{label}</p><p className="mt-2 text-3xl font-bold tracking-tight text-[#192d45]">{value}</p></div>)}</div>
    <p className="mb-2 mt-6 text-xs font-bold uppercase tracking-wider text-[#647083]">Subscription poll &amp; household</p>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{pollRows.map(([label,value])=><div key={label} className="rounded-xl border border-[#e1dfd8] bg-white p-5"><p className="text-xs font-semibold text-[#738090]">{label}</p><p className="mt-2 text-3xl font-bold tracking-tight text-[#192d45]">{value}</p></div>)}</div>
  </div>;
}

function AdminRegisterSnapshotsPanel({onChanged}:{onChanged:()=>void}) {
  const queryClient=useQueryClient();
  const [form,setForm]=useState({reference:'',denominator:'',cutoffAt:'',rulesDescription:'',integrityHash:''});
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const snapshots=useGetAdminRegisterSnapshots({query:{queryKey:getGetAdminRegisterSnapshotsQueryKey()}});
  const createSnapshot=useCreateAdminRegisterSnapshot();
  const set=(patch:Partial<typeof form>)=>setForm(current=>({...current,...patch}));
  const submit=(event:FormEvent)=>{
    event.preventDefault();
    setError('');setMessage('');
    const denominator=Number(form.denominator);
    if(!form.reference.trim()){setError('Enter a reference for this snapshot.');return;}
    if(!Number.isInteger(denominator)||denominator<1){setError('Enter the verified number of members as a whole number of at least 1.');return;}
    if(!form.cutoffAt){setError('Choose the register cutoff date this snapshot reflects.');return;}
    if(form.rulesDescription.trim().length<3){setError('Describe the rules used to compile the register.');return;}
    if(form.integrityHash.trim().length<3){setError('Enter an integrity hash so the snapshot can be checked later.');return;}
    createSnapshot.mutate({data:{
      reference:form.reference.trim(),
      denominator,
      cutoffAt:new Date(form.cutoffAt).toISOString(),
      rulesDescription:form.rulesDescription.trim(),
      integrityHash:form.integrityHash.trim(),
    }},{
      onSuccess:(saved:any)=>{
        setMessage(`Snapshot ${saved.reference} published with a denominator of ${saved.denominator}. The public threshold now uses this figure.`);
        setForm({reference:'',denominator:'',cutoffAt:'',rulesDescription:'',integrityHash:''});
        queryClient.invalidateQueries({queryKey:getGetAdminRegisterSnapshotsQueryKey()});
        onChanged();
      },
      onError:(raw:any)=>setError(raw?.data?.error||raw?.message||'The snapshot could not be published.'),
    });
  };
  return <div className="space-y-6">
    <div className="rounded-2xl border border-[#e1dfd8] bg-white p-6">
      <h2 className="font-semibold text-[#1c2e44]">Publish a register snapshot</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-[#687486]">The snapshot fixes the verified membership denominator that the constitutional two-thirds threshold is measured against. Snapshots are append-only: the most recent one by approval date is the figure the public pages report.</p>
      <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium text-[#33445a]">Reference
          <input value={form.reference} onChange={event=>set({reference:event.target.value})} placeholder="SNAP-2026-01" className="mt-1 w-full rounded-lg border border-[#d8d6cf] px-3 py-2 text-sm" />
        </label>
        <label className="text-sm font-medium text-[#33445a]">Verified members (denominator)
          <input value={form.denominator} onChange={event=>set({denominator:event.target.value})} inputMode="numeric" placeholder="350" className="mt-1 w-full rounded-lg border border-[#d8d6cf] px-3 py-2 text-sm" />
        </label>
        <label className="text-sm font-medium text-[#33445a]">Register cutoff
          <input type="date" value={form.cutoffAt} onChange={event=>set({cutoffAt:event.target.value})} className="mt-1 w-full rounded-lg border border-[#d8d6cf] px-3 py-2 text-sm" />
        </label>
        <label className="text-sm font-medium text-[#33445a]">Integrity hash
          <input value={form.integrityHash} onChange={event=>set({integrityHash:event.target.value})} placeholder="sha256:…" className="mt-1 w-full rounded-lg border border-[#d8d6cf] px-3 py-2 text-sm" />
        </label>
        <label className="text-sm font-medium text-[#33445a] sm:col-span-2">Rules used
          <textarea value={form.rulesDescription} onChange={event=>set({rulesDescription:event.target.value})} rows={3} placeholder="Describe how the register was compiled and verified." className="mt-1 w-full rounded-lg border border-[#d8d6cf] px-3 py-2 text-sm" />
        </label>
        {error&&<p className="text-sm text-[#a33b3b] sm:col-span-2">{error}</p>}
        {message&&<p className="text-sm text-[#315f43] sm:col-span-2">{message}</p>}
        <div className="sm:col-span-2"><button type="submit" disabled={createSnapshot.isPending} className="btn-primary disabled:opacity-50">{createSnapshot.isPending?'Publishing…':'Publish snapshot'} <ArrowRight size={15} /></button></div>
      </form>
    </div>
    {snapshots.isLoading?<Skeleton rows={2}/>:snapshots.isError?<ErrorLine retry={()=>snapshots.refetch()}/>
    :<div className="rounded-2xl border border-[#e1dfd8] bg-white p-6">
      <h2 className="font-semibold text-[#1c2e44]">Published snapshots</h2>
      {(!snapshots.data||snapshots.data.length===0)?<p className="mt-3 text-sm text-[#687486]">No register snapshot has been published yet. Until one exists the petition thresholds cannot be calculated.</p>
      :<div className="mt-4 space-y-3">{snapshots.data.map(snapshot=><div key={snapshot.id} className="rounded-xl border border-[#e8e6df] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold text-[#1c2e44]">{snapshot.reference}</p><p className="text-sm text-[#687486]">{snapshot.denominator} verified members</p></div>
        <p className="mt-2 text-xs text-[#738090]">Cutoff {snapshot.cutoffAt?new Date(snapshot.cutoffAt).toLocaleDateString():'—'} · approved {snapshot.approvedAt?new Date(snapshot.approvedAt).toLocaleString():'—'}</p>
        <p className="mt-2 text-sm leading-6 text-[#687486]">{snapshot.rulesDescription}</p>
        <p className="mt-1 text-xs text-[#8a94a3]">Integrity: {snapshot.integrityHash}</p>
      </div>)}</div>}
    </div>}
  </div>;
}

function AdminPetitionConfigurationPanel({canReview,onChanged}:{canReview:boolean;onChanged:()=>void}) {
  const queryClient=useQueryClient();
  const [form,setForm]=useState({title:'',petitionVersion:'',constitutionVersion:'',eligibilityText:'',openingAt:'',closingAt:'',registerSnapshotId:'',proposedThreshold:''});
  const [seeded,setSeeded]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const config=useGetAdminPetitionConfiguration({query:{queryKey:getGetAdminPetitionConfigurationQueryKey()}});
  const snapshots=useGetAdminRegisterSnapshots({query:{queryKey:getGetAdminRegisterSnapshotsQueryKey()}});
  const save=useSaveAdminPetitionConfiguration();
  const approve=useApproveAdminPetitionConfiguration();
  const close=useCloseAdminPetitionConfiguration();
  const current=config.data?.configuration??null;
  useEffect(()=>{
    if(seeded||!config.data)return;
    if(current){
      setForm({
        title:current.title??'',petitionVersion:current.petitionVersion??'',constitutionVersion:current.constitutionVersion??'',
        eligibilityText:current.eligibilityText??'',
        openingAt:current.openingAt?new Date(current.openingAt).toISOString().slice(0,10):'',
        closingAt:current.closingAt?new Date(current.closingAt).toISOString().slice(0,10):'',
        registerSnapshotId:current.registerSnapshotId??'',
        proposedThreshold:current.proposedThreshold!=null?String(current.proposedThreshold):'',
      });
    }
    setSeeded(true);
  },[seeded,config.data,current]);
  const refresh=()=>{queryClient.invalidateQueries({queryKey:getGetAdminPetitionConfigurationQueryKey()});queryClient.invalidateQueries({queryKey:getGetAdminDashboardQueryKey()});onChanged();};
  const set=(patch:Partial<typeof form>)=>setForm(cur=>({...cur,...patch}));
  const submit=(event:FormEvent)=>{
    event.preventDefault();setError('');setMessage('');
    if(form.title.trim().length<3){setError('Enter a title for the petition.');return;}
    if(!form.petitionVersion.trim()){setError('Enter the petition version.');return;}
    if(!form.constitutionVersion.trim()){setError('Enter the Constitution version.');return;}
    if(form.eligibilityText.trim().length<3){setError('Describe who is eligible to sign.');return;}
    if(!form.openingAt){setError('Choose an opening date.');return;}
    if(!form.closingAt){setError('Choose a closing date.');return;}
    const opening=new Date(form.openingAt);const closing=new Date(form.closingAt);
    if(closing<=opening){setError('The closing date must be after the opening date.');return;}
    const threshold=form.proposedThreshold.trim()===''?null:Number(form.proposedThreshold);
    if(threshold!==null&&(!Number.isInteger(threshold)||threshold<1)){setError('The proposed threshold must be a whole number of at least 1, or left blank.');return;}
    save.mutate({data:{
      title:form.title.trim(),petitionVersion:form.petitionVersion.trim(),constitutionVersion:form.constitutionVersion.trim(),
      eligibilityText:form.eligibilityText.trim(),openingAt:opening.toISOString(),closingAt:closing.toISOString(),
      registerSnapshotId:form.registerSnapshotId||null,proposedThreshold:threshold,
    }},{
      onSuccess:()=>{setMessage('Draft saved. Review the details, then approve to open the signing window.');refresh();},
      onError:(raw:any)=>setError(raw?.data?.error||raw?.message||'The configuration could not be saved.'),
    });
  };
  const runAction=(mutation:any,label:string)=>mutation.mutate(undefined,{
    onSuccess:()=>{setMessage(`${label} succeeded.`);refresh();},
    onError:(raw:any)=>setError(raw?.data?.error||raw?.message||`${label} failed.`),
  });
  const state=config.data?.state??'not-configured';
  const stateLabel=state.replaceAll('-',' ');
  return <div className="space-y-6">
    <div className="rounded-2xl border border-[#e1dfd8] bg-white p-5">
      <p className="text-xs font-bold uppercase tracking-wider text-[#647083]">Current state</p>
      <p className="mt-2 text-lg font-semibold capitalize text-[#1c2e44]">{stateLabel}</p>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-[#687486]">A configuration must be approved and inside its opening and closing window before residents can sign. Saving a new draft closes any configuration currently open.</p>
      {current&&<p className="mt-2 text-xs text-[#738090]">Persisted status: {current.status} · version {current.petitionVersion} · Constitution {current.constitutionVersion}</p>}
    </div>
    <div className="rounded-2xl border border-[#e1dfd8] bg-white p-6">
      <h2 className="font-semibold text-[#1c2e44]">{current?'Edit petition configuration':'Create petition configuration'}</h2>
      <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium text-[#33445a] sm:col-span-2">Title
          <input value={form.title} onChange={event=>set({title:event.target.value})} placeholder="Petition for adoption of the Draft Constitution" className="mt-1 w-full rounded-lg border border-[#d8d6cf] px-3 py-2 text-sm" />
        </label>
        <label className="text-sm font-medium text-[#33445a]">Petition version
          <input value={form.petitionVersion} onChange={event=>set({petitionVersion:event.target.value})} placeholder="1.0" className="mt-1 w-full rounded-lg border border-[#d8d6cf] px-3 py-2 text-sm" />
        </label>
        <label className="text-sm font-medium text-[#33445a]">Constitution version
          <input value={form.constitutionVersion} onChange={event=>set({constitutionVersion:event.target.value})} placeholder="1.0" className="mt-1 w-full rounded-lg border border-[#d8d6cf] px-3 py-2 text-sm" />
        </label>
        <label className="text-sm font-medium text-[#33445a]">Opening date
          <input type="date" value={form.openingAt} onChange={event=>set({openingAt:event.target.value})} className="mt-1 w-full rounded-lg border border-[#d8d6cf] px-3 py-2 text-sm" />
        </label>
        <label className="text-sm font-medium text-[#33445a]">Closing date
          <input type="date" value={form.closingAt} onChange={event=>set({closingAt:event.target.value})} className="mt-1 w-full rounded-lg border border-[#d8d6cf] px-3 py-2 text-sm" />
        </label>
        <label className="text-sm font-medium text-[#33445a]">Register snapshot
          <select value={form.registerSnapshotId} onChange={event=>set({registerSnapshotId:event.target.value})} className="mt-1 w-full rounded-lg border border-[#d8d6cf] px-3 py-2 text-sm">
            <option value="">Use the most recent published snapshot</option>
            {(snapshots.data??[]).map(snapshot=><option key={snapshot.id} value={snapshot.id}>{snapshot.reference} ({snapshot.denominator} members)</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-[#33445a]">Proposed threshold (informational)
          <input value={form.proposedThreshold} onChange={event=>set({proposedThreshold:event.target.value})} inputMode="numeric" placeholder="Optional" className="mt-1 w-full rounded-lg border border-[#d8d6cf] px-3 py-2 text-sm" />
          <span className="mt-1 block text-xs font-normal text-[#8a94a3]">Shown on the petition page for information. The two-thirds rule always decides whether the threshold is reached.</span>
        </label>
        <label className="text-sm font-medium text-[#33445a] sm:col-span-2">Eligibility text
          <textarea value={form.eligibilityText} onChange={event=>set({eligibilityText:event.target.value})} rows={3} placeholder="Verified Salama Park residents who have completed registration may sign." className="mt-1 w-full rounded-lg border border-[#d8d6cf] px-3 py-2 text-sm" />
        </label>
        {error&&<p className="text-sm text-[#a33b3b] sm:col-span-2">{error}</p>}
        {message&&<p className="text-sm text-[#315f43] sm:col-span-2">{message}</p>}
        <div className="flex flex-wrap gap-3 sm:col-span-2">
          <button type="submit" disabled={save.isPending} className="btn-primary disabled:opacity-50">{save.isPending?'Saving…':'Save draft'} <ArrowRight size={15} /></button>
          {canReview&&current?.status==='draft'&&<button type="button" disabled={approve.isPending} onClick={()=>runAction(approve,'Approval')} className="btn-secondary disabled:opacity-50">{approve.isPending?'Approving…':'Approve configuration'}</button>}
          {canReview&&current&&current.status!=='closed'&&<button type="button" disabled={close.isPending} onClick={()=>runAction(close,'Closure')} className="btn-secondary disabled:opacity-50">{close.isPending?'Closing…':'Close petition'}</button>}
        </div>
      </form>
    </div>
  </div>;
}

function AdminRolesPanel({isAdmin}:{isAdmin:boolean}) {
  const queryClient=useQueryClient();
  const [userId,setUserId]=useState('');
  const [role,setRole]=useState('administrator');
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const roles=useGetAdminRoles({query:{queryKey:getGetAdminRolesQueryKey(),enabled:isAdmin}});
  const grant=useGrantAdminRole();
  const revoke=useRevokeAdminRole();
  const refresh=()=>queryClient.invalidateQueries({queryKey:getGetAdminRolesQueryKey()});
  const submit=(event:FormEvent)=>{
    event.preventDefault();setError('');setMessage('');
    if(!userId.trim()){setError('Enter the Clerk account ID of the person to promote.');return;}
    grant.mutate({data:{userId:userId.trim(),role:role as any}},{
      onSuccess:(saved:any)=>{setMessage(`${saved.userId} now holds: ${(saved.roles??[]).join(', ')||'no roles'}.`);setUserId('');refresh();},
      onError:(raw:any)=>setError(raw?.data?.error||raw?.message||'The role could not be granted.'),
    });
  };
  const remove=(id:string,revokeRole:string)=>revoke.mutate({data:{userId:id,role:revokeRole as any}},{
    onSuccess:(saved:any)=>{setMessage(`${saved.userId} now holds: ${(saved.roles??[]).join(', ')||'no roles'}.`);refresh();},
    onError:(raw:any)=>setError(raw?.data?.error||raw?.message||'The role could not be revoked.'),
  });
  if(!isAdmin)return <div className="rounded-2xl border border-dashed border-[#cfd5cd] bg-[#fbfaf6] p-6 sm:p-8"><div className="mb-4 grid size-11 place-items-center rounded-xl bg-[#eaf1e8] text-[#477454]"><LockKeyhole size={20}/></div><h2 className="serif text-2xl font-bold text-[#1d3048]">Administrator access required.</h2><p className="mt-2 max-w-xl text-sm leading-6 text-[#687486]">Only an association administrator can view or change role assignments.</p></div>;
  const items=roles.data?.items??[];
  return <div className="space-y-6">
    <div className="rounded-2xl border border-[#e1dfd8] bg-white p-6">
      <h2 className="font-semibold text-[#1c2e44]">Grant an association role</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-[#687486]">Roles control access to privileged workflows. Paste the person's Clerk account ID (it begins with <code className="rounded bg-[#f2f1ea] px-1">user_</code>). The account gets a profile automatically if it has never registered.</p>
      <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium text-[#33445a] sm:col-span-2">Clerk account ID
          <input value={userId} onChange={event=>setUserId(event.target.value)} placeholder="user_3KsJLm3CYZhLJXQ3JjcHQ7Fp2IB" className="mt-1 w-full rounded-lg border border-[#d8d6cf] px-3 py-2 text-sm" />
        </label>
        <label className="text-sm font-medium text-[#33445a]">Role
          <select value={role} onChange={event=>setRole(event.target.value)} className="mt-1 w-full rounded-lg border border-[#d8d6cf] px-3 py-2 text-sm">
            <option value="administrator">Administrator (full access)</option>
            <option value="returning-officer">Returning Officer</option>
            <option value="scrutineer">Scrutineer</option>
            <option value="resident">Resident</option>
          </select>
        </label>
        {error&&<p className="text-sm text-[#a33b3b] sm:col-span-2">{error}</p>}
        {message&&<p className="text-sm text-[#315f43] sm:col-span-2">{message}</p>}
        <div className="sm:col-span-2"><button type="submit" disabled={grant.isPending} className="btn-primary disabled:opacity-50">{grant.isPending?'Granting…':'Grant role'} <ArrowRight size={15} /></button></div>
      </form>
    </div>
    <div className="rounded-2xl border border-[#e1dfd8] bg-white p-6">
      <h2 className="font-semibold text-[#1c2e44]">Current role holders</h2>
      <p className="mt-2 text-sm leading-6 text-[#687486]">Roles granted through the portal. The bootstrap administrator set by the server environment is not listed here but keeps full access.</p>
      {roles.isLoading?<div className="mt-4"><Skeleton rows={2}/></div>:roles.isError?<div className="mt-4"><ErrorLine retry={()=>roles.refetch()}/></div>
      :items.length===0?<p className="mt-3 text-sm text-[#687486]">No roles have been granted through the portal yet.</p>
      :<div className="mt-4 space-y-3">{items.map((item:any)=><div key={`${item.userId}-${item.role}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e8e6df] p-4">
        <div>
          <p className="font-mono text-sm text-[#1c2e44]">{item.userId}</p>
          <p className="mt-1 text-xs text-[#738090]"><span className="font-semibold uppercase tracking-wide text-[#477454]">{item.role}</span> · granted {item.assignedAt?new Date(item.assignedAt).toLocaleString():'—'}</p>
        </div>
        <button type="button" disabled={revoke.isPending} onClick={()=>remove(item.userId,item.role)} className="btn-secondary disabled:opacity-50">Revoke</button>
      </div>)}</div>}
    </div>
    <div className="rounded-2xl border border-[#e1dfd8] bg-[#fbfaf6] p-5">
      <p className="text-xs leading-6 text-[#687486]"><span className="font-semibold text-[#33445a]">Administrator:</span> full access to every workflow, including roles. <span className="font-semibold text-[#33445a]">Returning Officer:</span> verifies applications and signatures, and approves or closes the petition. <span className="font-semibold text-[#33445a]">Scrutineer:</span> read access to the administrative views for independent oversight. <span className="font-semibold text-[#33445a]">Resident:</span> the standard member role. You cannot remove your own administrator role.</p>
    </div>
  </div>;
}

function AdminApplicationsPanel({canReview,onChanged}:{canReview:boolean;onChanged:()=>void}) {
  const queryClient=useQueryClient();
  const [search,setSearch]=useState('');
  const [reasons,setReasons]=useState<Record<string,string>>({});
  const [fulfilment,setFulfilment]=useState<Record<string,{receivedBy:string;verifiedAgainstNrc:boolean;rejectionCategory:string;verificationNotes:string}>>({});
  const [actionError,setActionError]=useState('');
  const params={page:1,pageSize:25,search:search.trim()||undefined};
  const applications=useGetAdminApplications(params,{query:{queryKey:getGetAdminApplicationsQueryKey(params)}});
  const review=useReviewMembershipApplication();
  const draftFor=(item:any)=>fulfilment[item.id]??{receivedBy:item.receivedBy??'',verifiedAgainstNrc:item.verifiedAgainstNrc??false,rejectionCategory:item.rejectionCategory??'',verificationNotes:item.verificationNotes??''};
  const setDraft=(item:any,patch:Partial<{receivedBy:string;verifiedAgainstNrc:boolean;rejectionCategory:string;verificationNotes:string}>)=>setFulfilment(current=>({...current,[item.id]:{...draftFor(item),...patch}}));
  const submitReview=(item:any,status:'verified'|'clarification-requested'|'rejected')=>{
    const reason=reasons[item.id]?.trim()||'';
    const draft=draftFor(item);
    setActionError('');
    if(reason.length<3){setActionError('Enter a reason of at least 3 characters before recording a decision.');return;}
    if(status==='rejected'&&!draft.rejectionCategory){setActionError('Choose a rejection category before rejecting an application.');return;}
    review.mutate({id:item.id,data:{
      status,
      reason,
      receivedBy:draft.receivedBy.trim()||null,
      verifiedAgainstNrc:draft.verifiedAgainstNrc,
      rejectionCategory:status==='rejected'?draft.rejectionCategory as 'duplicate'|'not-resident'|'incomplete-declaration'|'other':null,
      verificationNotes:draft.verificationNotes.trim()||null,
    }},{onSuccess:()=>{
      setReasons(current=>({...current,[item.id]:''}));
      setFulfilment(current=>({...current,[item.id]:draftFor({id:item.id})}));
      queryClient.invalidateQueries({queryKey:getGetAdminApplicationsQueryKey(params)});
      onChanged();
    },onError:error=>setActionError(serverErrorMessage(error,'The decision could not be recorded. Please try again.'))});
  };
  return <section>
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold text-[#1c2e44]">Resident applications</h2><p className="mt-1 text-xs text-[#687486]">Private resident details are visible only to association officials with an authorized role. Section F verification is recorded below each application.</p></div><input aria-label="Search resident applications" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search by name, NRC, reference or membership number" className="field sm:max-w-xs"/></div>
    {actionError&&<div className="mb-4"><Notice kind="error">{actionError}</Notice></div>}
    {applications.isLoading?<Skeleton rows={3}/>:applications.isError?<ErrorLine retry={()=>applications.refetch()}/>:!applications.data?.items.length?<EmptyPanel title="No applications found" text="No matching applications have been submitted."/>:
      <div className="space-y-3">{applications.data.items.map(item=>{
        const draft=draftFor(item);
        return <article key={item.id} className="rounded-xl border border-[#e1dfd8] bg-white p-5">
          <div>
            <p className="font-semibold text-[#1c2e44]">{item.fullName}</p>
            <p className="mt-1 text-xs text-[#687486]">Reference {item.reference} · {item.status.replaceAll('-',' ')}{item.membershipCategory?` · ${item.membershipCategory.replaceAll('-',' ')} membership`:''}</p>
            <p className="mt-2 text-sm text-[#536174]">{item.houseNumber}, {item.streetOrZone} · {item.phone}{item.email?` · ${item.email}`:''}</p>
            <p className="mt-1 text-xs text-[#87918e]">NRC {item.nrcNumber||'—'} · Passport {item.passportNumber||'—'} · Date of birth {item.dateOfBirth||'—'} · {item.gender||'—'} · {item.nationality||'—'}</p>
            <p className="mt-1 text-xs text-[#87918e]">Residency: {item.residencyStatus?item.residencyStatus.replaceAll('-',' '):'—'} since {item.residencySince||'—'} · Owns property: {item.ownsProperty?'yes':'no'} · Subscription: {item.subscriptionVote?item.subscriptionVote.toUpperCase():'—'}</p>
            {item.membershipNumber&&<p className="mt-1 text-xs text-[#315f43]">Membership number {item.membershipNumber}{item.admittedAt?` · Admitted ${new Date(item.admittedAt).toLocaleDateString()}`:''}</p>}
            <p className="mt-1 text-xs text-[#87918e]">Submitted {new Date(item.submittedAt).toLocaleString()}{item.receivedBy?` · Received by ${item.receivedBy}`:''}{typeof item.verifiedAgainstNrc==='boolean'?` · NRC verified: ${item.verifiedAgainstNrc?'yes':'no'}`:''}{item.rejectionCategory?` · Rejection: ${item.rejectionCategory.replaceAll('-',' ')}`:''}</p>
            {item.decisionReason&&<p className="mt-2 text-sm text-[#687486]">Decision note: {item.decisionReason}</p>}
            {item.verificationNotes&&<p className="mt-1 text-sm text-[#687486]">Verification notes: {item.verificationNotes}</p>}
          </div>
          {canReview&&<div className="mt-4 border-t border-[#e8e6df] pt-4"><p className="mb-3 text-xs font-bold uppercase tracking-wider text-[#647083]">Section F · Verification record</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-semibold text-[#536174]">Received by<input value={draft.receivedBy} onChange={event=>setDraft(item,{receivedBy:event.target.value})} className="field mt-1.5" maxLength={160} placeholder="Street representative / official" /></label>
              <label className="block text-xs font-semibold text-[#536174]">Rejection category<select value={draft.rejectionCategory} onChange={event=>setDraft(item,{rejectionCategory:event.target.value})} className="field mt-1.5"><option value="">Not applicable</option><option value="duplicate">Duplicate application</option><option value="not-resident">Not a resident</option><option value="incomplete-declaration">Incomplete declaration</option><option value="other">Other</option></select></label>
            </div>
            <label className="mt-3 flex items-center gap-2 text-xs font-semibold text-[#536174]"><input type="checkbox" checked={draft.verifiedAgainstNrc} onChange={event=>setDraft(item,{verifiedAgainstNrc:event.target.checked})} className="accent-[#315f43]" />Details verified against NRC / passport</label>
            <label className="mt-3 block text-xs font-semibold text-[#536174]">Decision reason<input value={reasons[item.id]??''} onChange={event=>setReasons(current=>({...current,[item.id]:event.target.value}))} className="field mt-1.5" maxLength={1000} /></label>
            <label className="mt-3 block text-xs font-semibold text-[#536174]">Verification notes (optional)<input value={draft.verificationNotes} onChange={event=>setDraft(item,{verificationNotes:event.target.value})} className="field mt-1.5" maxLength={1000} /></label>
            <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={review.isPending} onClick={()=>submitReview(item,'verified')} className="btn-primary disabled:opacity-50">Verify</button><button type="button" disabled={review.isPending} onClick={()=>submitReview(item,'clarification-requested')} className="btn-secondary disabled:opacity-50">Request clarification</button><button type="button" disabled={review.isPending} onClick={()=>submitReview(item,'rejected')} className="btn-secondary disabled:opacity-50">Reject</button></div>
          </div>}
        </article>;
      })}</div>}
  </section>;
}

function AdminPetitionPanel({ canReview, onChanged }: { canReview: boolean; onChanged: () => void }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | 'accepted' | 'disputed' | 'rejected' | 'withdrawn'>('');
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [register, setRegister] = useState<Record<string, boolean>>({});
  const [duplicate, setDuplicate] = useState<Record<string, boolean>>({});
  const [actionError, setActionError] = useState('');
  const params = { page: 1, pageSize: 25, search: search.trim() || undefined, status: statusFilter || undefined };
  const submissions = useGetAdminPetitionSubmissions(params, { query: { queryKey: getGetAdminPetitionSubmissionsQueryKey(params) } });
  const verify = useVerifyPetitionSubmission();
  const submitVerify = (id: string, decision: 'accepted' | 'disputed' | 'rejected') => {
    const reason = reasons[id]?.trim() || '';
    setActionError('');
    if (reason.length < 3) { setActionError('Enter a reason of at least 3 characters before recording a decision.'); return; }
    verify.mutate({ id, data: { status: decision, onMembersRegister: register[id] ?? false, duplicateFlag: duplicate[id] ?? false, reason } }, {
      onSuccess: () => {
        setReasons(current => ({ ...current, [id]: '' }));
        queryClient.invalidateQueries({ queryKey: getGetAdminPetitionSubmissionsQueryKey(params) });
        onChanged();
      },
      onError: error => setActionError(serverErrorMessage(error, 'The verification could not be recorded. Please try again.')),
    });
  };
  return <section>
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div><h2 className="font-semibold text-[#1c2e44]">Petition signature verification</h2><p className="mt-1 text-xs text-[#687486]">Returning Officers check each signature against the members register before it counts toward the threshold.</p></div>
      <div className="flex gap-2">
        <input aria-label="Search petition signatures" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, reference or house" className="field sm:max-w-xs" />
        <select aria-label="Filter by status" value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} className="field sm:max-w-[160px]">
          <option value="">All statuses</option>
          <option value="accepted">Accepted</option>
          <option value="disputed">Disputed</option>
          <option value="rejected">Rejected</option>
          <option value="withdrawn">Withdrawn</option>
        </select>
      </div>
    </div>
    {actionError && <div className="mb-4"><Notice kind="error">{actionError}</Notice></div>}
    {submissions.isLoading ? <Skeleton rows={3} /> : submissions.isError ? <ErrorLine retry={() => submissions.refetch()} /> : !submissions.data?.items.length ? <EmptyPanel title="No signatures found" text="No matching petition signatures have been submitted yet." /> :
      <div className="space-y-3">{submissions.data.items.map(item => <article key={item.id} className="rounded-xl border border-[#e1dfd8] bg-white p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="font-semibold text-[#1c2e44]">{item.fullName}</p>
            <p className="mt-1 text-xs text-[#687486]">Reference {item.reference} · {item.status.replaceAll('-', ' ')}</p>
            <p className="mt-2 text-sm text-[#536174]">{item.houseNumber}, {item.streetOrZone} · {item.phone}</p>
            <p className="mt-1 text-xs text-[#87918e]">Subscription choices, household details and volunteer skills are recorded in the resident application at <Link href="/admin/members" className="text-[#315f43] underline">Members &amp; applications</Link>.</p>
            <p className="mt-1 text-xs text-[#87918e]">Submitted {new Date(item.submittedAt).toLocaleString()}{item.verifiedAt ? ` · Verified ${new Date(item.verifiedAt).toLocaleString()}` : ''}</p>
            {item.verificationNotes && <p className="mt-2 text-sm text-[#687486]">Last note: {item.verificationNotes}</p>}
          </div>
        </div>
        {canReview && <div className="mt-4 border-t border-[#e8e6df] pt-4">
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-xs font-semibold text-[#536174]"><input type="checkbox" checked={register[item.id] ?? item.onMembersRegister ?? false} onChange={e => setRegister(current => ({ ...current, [item.id]: e.target.checked }))} className="accent-[#315f43]" />On members register</label>
            <label className="flex items-center gap-2 text-xs font-semibold text-[#536174]"><input type="checkbox" checked={duplicate[item.id] ?? item.duplicateFlag ?? false} onChange={e => setDuplicate(current => ({ ...current, [item.id]: e.target.checked }))} className="accent-[#9a4a43]" />Possible duplicate</label>
          </div>
          <label className="mt-3 block text-xs font-semibold text-[#536174]">Verification note<input value={reasons[item.id] ?? item.verificationNotes ?? ''} onChange={e => setReasons(current => ({ ...current, [item.id]: e.target.value }))} className="field mt-1.5" maxLength={1000} placeholder="Reason for this decision" /></label>
          <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={verify.isPending} onClick={() => submitVerify(item.id, 'accepted')} className="btn-primary disabled:opacity-50">Accept</button><button type="button" disabled={verify.isPending} onClick={() => submitVerify(item.id, 'disputed')} className="btn-secondary disabled:opacity-50">Flag as disputed</button><button type="button" disabled={verify.isPending} onClick={() => submitVerify(item.id, 'rejected')} className="btn-secondary disabled:opacity-50">Reject</button></div>
        </div>}
      </article>)}</div>}
  </section>;
}

function HomeRedirect() { return <><Show when="signed-in"><Redirect to="/resident/dashboard" /></Show><Show when="signed-out"><HomePage /></Show></>; }
function RoutedErrorBoundary({children}:{children:ReactNode}) { const [location]=useLocation(); return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>; }
function RouterRoutes() {
  const routes=['/about','/documents','/petition','/membership','/announcements','/elections','/results','/privacy','/faq','/contact'];
  const resident=['/resident/dashboard','/resident/profile','/resident/application','/resident/petition','/resident/voting','/resident/receipts','/resident/notifications'];
  const admin=Object.keys(adminCopy);
  return <RoutedErrorBoundary><Switch>
    <Route path="/" component={HomeRedirect}/>
    {routes.map(path=><Route key={path} path={path} component={()=> <PublicPage path={path}/>}/>)}
    <Route path="/login" component={LoginRoute}/><Route path="/register" component={RegisterRoute}/>
    <Route path="/forgot-password" component={()=> <AppShell><AuthSupport path="/forgot-password"/></AppShell>}/>
    <Route path="/verify-account" component={()=> <AppShell><AuthSupport path="/verify-account"/></AppShell>}/>
    <Route path="/sign-in/*?" component={()=> <AppShell><SignInPage/></AppShell>}/>
    <Route path="/sign-up/*?" component={()=> <AppShell><SignUpPage/></AppShell>}/>
    {resident.map(path=><Route key={path} path={path} component={()=> <ResidentPage path={path}/>}/>)}
    {admin.map(path=><Route key={path} path={path} component={()=> <AdminPage path={path}/>}/>)}
    <Route component={NotFound}/>
  </Switch></RoutedErrorBoundary>;
}
function NotFound() { return <AppShell><div className="mx-auto max-w-3xl px-5 py-24 text-center"><Eyebrow>404 · Not found</Eyebrow><h1 className="serif text-4xl font-bold text-[#192d45]">This page is not here.</h1><p className="mt-3 text-sm text-[#687486]">The address may have changed. Use the home page to find official information.</p><div className="mt-6 flex justify-center"><ButtonLink href="/">Go to homepage <ArrowRight size={15}/></ButtonLink></div></div></AppShell>; }

function ClerkProviderWithRoutes() {
  const [,setLocation]=useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={clerkAppearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} localization={{signIn:{start:{title:'Welcome back',subtitle:'Sign in to access your resident account'}},signUp:{start:{title:'Create your resident account',subtitle:'Get started with Salama Park resident services'}}}} routerPush={to=>setLocation(stripBase(to))} routerReplace={to=>setLocation(stripBase(to),{replace:true})}><QueryClientProvider client={queryClient}><ClerkQueryClientCacheInvalidator/><RouterRoutes/></QueryClientProvider></ClerkProvider>;
}
function ClerkQueryClientCacheInvalidator() {
  const {addListener}=useClerk();
  const client=useQueryClient();
  const previousUserId=useRef<string|null|undefined>(undefined);
  useEffect(()=>{
    const unsubscribe=addListener(({user})=>{
      const userId=user?.id??null;
      if(previousUserId.current!==undefined&&previousUserId.current!==userId)client.clear();
      previousUserId.current=userId;
    });
    return unsubscribe;
  },[addListener,client]);
  return null;
}
function App() { return <TooltipProvider><WouterRouter base={basePath}><ClerkProviderWithRoutes/></WouterRouter><Toaster/></TooltipProvider>; }
export default App;
