import { Link } from 'react-router-dom';
import Logo from '../assets/images/logo.png';
import { useLanguage } from '../i18n/hooks/useLanguage';

export default function Footer() {
  const { t } = useLanguage();
  return (
    <footer className="bg-white border-t border-gray-100 pt-16 pb-8">
      <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-4 gap-12 mb-12">
        <div className="col-span-1 md:col-span-2">
          <img src={Logo} alt="VALO Logo" className="h-8 object-contain mb-4 filter grayscale opacity-50" />
          <p className="text-gray-500 max-w-sm leading-relaxed">
            {t('common.footerDescription')}
          </p>
        </div>
        <div>
          <h4 className="font-bold text-charcoal mb-4">{t('common.platform')}</h4>
          <ul className="space-y-3 text-gray-500 text-sm">
            <li><a href="#" className="hover:text-gold transition">{t('common.customerPortal')}</a></li>
            <li><a href="#" className="hover:text-gold transition">{t('common.kioskControl')}</a></li>
            <li><a href="#" className="hover:text-gold transition">{t('common.adminDashboard')}</a></li>
          </ul>
        </div>
        <div>
          <h4 className="font-bold text-charcoal mb-4">{t('common.legal')}</h4>
          <ul className="space-y-3 text-gray-500 text-sm">
            <li><Link to="/policies" className="hover:text-gold transition">{t('common.terms')}</Link></li>
            <li><Link to="/policies" className="hover:text-gold transition">{t('common.privacy')}</Link></li>
            <li><Link to="/policies" className="hover:text-gold transition">{t('common.refund')}</Link></li>
          </ul>
        </div>
      </div>
      <div className="text-center text-gray-400 text-sm border-t border-gray-100 pt-8 max-w-7xl mx-auto">
        © 2026 VALO Smart Parking. Developed by Vo Dai Vy.
      </div>
    </footer>
  );
}
