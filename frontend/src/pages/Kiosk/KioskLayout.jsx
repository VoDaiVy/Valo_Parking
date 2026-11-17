import { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import carImage from '../../assets/images/Kiosk/CarKiosk.png';
import logoImage from '../../assets/images/Kiosk/LogoKiosk.png';

export default function KioskLayout() {
  const [time, setTime] = useState(new Date());
  const location = useLocation();

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (date) => {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  // Determine active step from URL
  let currentStep = 1;
  if (location.pathname.includes('step2')) currentStep = 2;
  if (location.pathname.includes('step3')) currentStep = 3;

  return (
    <>
      <style>
        {`
          @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700;800;900&display=swap');
          @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap');
          
          .kiosk-font { font-family: 'Outfit', sans-serif; }
          .digital-font { font-family: 'Share Tech Mono', monospace; }
          .slanted-yellow {
            clip-path: polygon(0 0, 90% 0, 40% 100%, 0 100%);
          }
        `}
      </style>
      <div className="relative flex w-full h-full bg-[#fcfcfc] overflow-hidden kiosk-font">

        {/* ─── GLOBAL BACKGROUND SLANT & POLYGONS ─── */}
        {/* The slanted yellow background that divides the screen */}
        <div className="absolute top-0 left-0 w-[50%] h-full bg-[#FFDF00] slanted-yellow z-0">
          {/* Dot pattern */}
          <div
            className="absolute inset-0 opacity-10"
            style={{
              backgroundImage: 'radial-gradient(#000 1.5px, transparent 1.5px)',
              backgroundSize: '24px 24px'
            }}
          ></div>
        </div>

        {/* Floating Grid Pattern (Darker Yellow/Gold) near the slant edge */}
        <div className="absolute top-0 left-0 w-[55%] h-full z-10 pointer-events-none opacity-80">
          {/* Row 1 */}
          <div className="absolute top-[45%] left-[40%] w-10 h-8 bg-[#cca300] transform -skew-x-[25deg]"></div>
          <div className="absolute top-[48%] left-[50%] w-14 h-10 bg-[#cca300] transform -skew-x-[25deg]"></div>

          {/* Row 2 */}
          <div className="absolute top-[55%] left-[30%] w-14 h-10 bg-[#cca300] transform -skew-x-[25deg]"></div>
          <div className="absolute top-[58%] left-[55%] w-12 h-8 bg-[#cca300] transform -skew-x-[25deg]"></div>

          {/* Row 3 */}
          <div className="absolute top-[65%] left-[20%] w-12 h-10 bg-[#cca300] transform -skew-x-[25deg]"></div>
          <div className="absolute top-[68%] left-[40%] w-14 h-12 bg-[#cca300] transform -skew-x-[25deg]"></div>
          <div className="absolute top-[71%] left-[60%] w-14 h-12 bg-[#cca300] transform -skew-x-[25deg]"></div>

          {/* Row 4 (Bottom) */}
          <div className="absolute top-[85%] left-[10%] w-12 h-12 bg-[#cca300] transform -skew-x-[25deg]"></div>
          <div className="absolute top-[90%] left-[30%] w-14 h-14 bg-[#cca300] transform -skew-x-[25deg]"></div>
          <div className="absolute top-[95%] left-[55%] w-16 h-14 bg-[#cca300] transform -skew-x-[25deg]"></div>
        </div>

        {/* ─── LEFT CONTENT (Logo, Clock, Car) ─── */}
        <div className="w-[42%] shrink-0 relative h-full flex flex-col z-20 pointer-events-none">
          {/* Content (Logo & Clock) */}
          <div className="relative flex flex-col items-center pt-4 w-full pr-16 pl-2">
            {/* Logo */}
            <div className="w-52 mb-2 drop-shadow-sm">
              <img src={logoImage} alt="Valo Parking" className="w-full h-auto" />
            </div>

            {/* Digital Clock */}
            <div
              className="text-[130px] font-bold text-[#0f172a] leading-none digital-font"
              style={{
                textShadow: '3px 3px 0 rgba(255,255,255,0.3)',
                WebkitTextStroke: '2px #0f172a'
              }}
            >
              {formatTime(time)}
            </div>
          </div>

          {/* Car Image - Flush with bottom */}
          <div className="absolute bottom-0 left-0 w-[115%] flex items-end justify-start">
            {/* Adjusted translate-y to ensure it hits the bottom perfectly without transparent padding */}
            <img src={carImage} alt="Car" className="w-full h-auto object-contain transform translate-y-[22px] drop-shadow-[0_15px_25px_rgba(0,0,0,0.3)]" />
          </div>
        </div>

        {/* ─── RIGHT PANEL (Form Content) ─── */}
        <div className="flex-1 flex flex-col h-full px-12 py-6 overflow-hidden z-30">

          {/* Stepper Header */}
          <div className="flex items-center justify-center max-w-[500px] mx-auto w-full mb-10">

            <StepIndicator num={1} label="Information" isActive={currentStep >= 1} isCurrent={currentStep === 1} />
            <div className={`flex-1 h-0.5 mx-4 ${currentStep >= 2 ? 'bg-[#FFDF00]' : 'bg-gray-200'}`}></div>

            <StepIndicator num={2} label="Choose a place" isActive={currentStep >= 2} isCurrent={currentStep === 2} />
            <div className={`flex-1 h-0.5 mx-4 ${currentStep >= 3 ? 'bg-[#FFDF00]' : 'bg-gray-200'}`}></div>

            <StepIndicator num={3} label="Confirm" isActive={currentStep >= 3} isCurrent={currentStep === 3} />

          </div>

          {/* Main Content Area */}
          <div className="flex-1 flex flex-col min-h-0">
            <Outlet />
          </div>

        </div>

      </div>
    </>
  );
}

function StepIndicator({ num, label, isActive, isCurrent }) {
  return (
    <div className="flex flex-col items-center gap-3 relative">
      <div className={`
        w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold transition-all z-10
        ${isCurrent ? 'bg-[#FFDF00] text-[#0f172a] shadow-[0_4px_15px_rgba(255,223,0,0.4)]' :
          isActive ? 'bg-[#0f172a] text-white' : 'bg-white border-2 border-gray-200 text-gray-300'}
      `}>
        {num}
      </div>
      <span className={`absolute top-12 text-[10px] font-bold uppercase tracking-widest whitespace-nowrap ${isCurrent ? 'text-[#0f172a]' : isActive ? 'text-gray-500' : 'text-gray-300'}`}>
        {label}
      </span>
    </div>
  );
}
