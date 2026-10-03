import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-24 text-center sm:px-6">
      <p className="plate-caption">404</p>
      <h1 className="font-display mt-2 text-5xl text-bone-100">Nothing at this coordinate</h1>
      <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-bone-300">
        That page does not exist, or the plan it referred to belongs to a different session and is
        deliberately indistinguishable from a page that never existed.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/tonight" className="btn btn-primary">
          Plan tonight
        </Link>
        <Link href="/catalogue" className="btn">
          Browse the catalogue
        </Link>
      </div>
    </div>
  );
}