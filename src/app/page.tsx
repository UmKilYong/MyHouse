import MapApp from "@/components/MapApp";

export default function Home() {
  return <MapApp ncpKeyId={process.env.NEXT_PUBLIC_NCP_KEY_ID ?? null} />;
}
