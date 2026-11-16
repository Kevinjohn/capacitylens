import { useLocation, useNavigate } from 'react-router-dom';

/** Shows the current route and navigates to a settings deep link when clicked. */
export function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <button
      type="button"
      data-testid="location-probe"
      onClick={() => void navigate('/settings?tab=security')}
    >
      {location.pathname}
      {location.search}
      {location.hash}
    </button>
  );
}
