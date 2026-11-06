import { brand } from "@/lib/brand";

/** Keep the real U.C.A. photograph free of controls and animated overlays. */
export function WelcomePhoto() {
  return (
    <figure className="welcome-showcase welcome-photo">
      <div
        className={`uca-photo-frame ${brand.implementPhotoPath ? "has-photo" : "without-photo"}`}
      >
        {brand.implementPhotoPath && (
          <img
            className="uca-implement-photo"
            src={brand.implementPhotoPath}
            alt={brand.implementPhotoAlt}
            width={1000}
            height={700}
            fetchPriority="high"
          />
        )}
        <div className="welcome-photo-vignette" aria-hidden="true" />
      </div>
    </figure>
  );
}
