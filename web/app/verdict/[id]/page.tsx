import { Header } from '@/components/header';
import { PublicVerdict } from '@/components/public-verdict';
export default async function Verdict({ params }: { params: Promise<{ id: string }> }) { return <><Header/><PublicVerdict id={(await params).id}/></>; }
