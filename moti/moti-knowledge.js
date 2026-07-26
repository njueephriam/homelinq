/* Moti offline fallback knowledge — HomeLinq.
   Used only if the AI is unavailable. The live AI Moti uses the
   moti_knowledge table in Supabase. */
window.MOTI_KB = {
  greeting: "Hi, I'm Moti - your HomeLinq assistant. I can help you find a Gas Safe registered engineer, understand boiler servicing and certificates, or get set up as an engineer. Ask me anything.",
  starters: [
    "What is HomeLinq?",
    "How do I book an engineer?",
    "What services can I book?",
    "What is a gas safety certificate?",
    "I'm an engineer - how do I join?"
  ],
  fallback: "Good question - I don't have that one in my notes yet. The HomeLinq team can help directly. You can reach support from your account, or the messaging area.",
  entries: [
    { id:"what", tags:["what","homelinq","about"],
      a:"HomeLinq connects homeowners with Gas Safe registered engineers for boiler repairs, servicing, installations and gas safety certificates - booked in minutes, with fixed upfront pricing." },
    { id:"book", tags:["book","booking","find","engineer","near"],
      a:"Use the find-an-engineer tool to see Gas Safe registered engineers near you, pick one, choose your service and book. Pricing is shown upfront, so there are no surprises." },
    { id:"services", tags:["services","boiler","repair","servicing","installation","install"],
      a:"HomeLinq covers boiler repairs, servicing, new boiler installations and gas safety certificates. For gas or boiler emergencies there is 24/7 cover." },
    { id:"emergency", tags:["emergency","urgent","smell","gas","leak"],
      a:"If you smell gas, leave the property and call the National Gas Emergency line on 0800 111 999 first. HomeLinq also has 24/7 cover for boiler and gas emergencies." },
    { id:"pricing", tags:["price","pricing","cost","payment","pay","stripe"],
      a:"HomeLinq shows fixed, upfront pricing before you book, so you know the cost in advance. Payments are handled securely through Stripe." },
    { id:"gassafe", tags:["gas","safe","qualified","verified","registered","trust","safety"],
      a:"Every engineer on HomeLinq is Gas Safe registered and verified - the official UK register of engineers legally allowed to work on gas appliances." },
    { id:"passport", tags:["passport","boiler","history","record"],
      a:"A boiler passport is HomeLinq's record of your boiler - its history, services, repairs and certificates in one place. Handy for future servicing and as proof of upkeep." },
    { id:"cp12", tags:["cp12","certificate","landlord","gas safety certificate"],
      a:"A CP12, or gas safety certificate, confirms gas appliances have been checked and are safe. Landlords need one each year, and a HomeLinq engineer can carry out the check and issue it." },
    { id:"engineer", tags:["engineer","pro","join","sign","accounting","saas"],
      a:"HomeLinq Pro is the engineer side: win local jobs, and run your business - jobs, quotes, invoices, expenses, mileage, certificates and boiler passports in one place. Create an engineer profile to join." },
    { id:"invoices", tags:["quote","quotes","invoice","invoices","admin"],
      a:"Inside HomeLinq Pro, engineers can send quotes, raise invoices, take payment and keep expenses and mileage in order - the admin side handled." },
    { id:"certificate", tags:["certificate","cp12","gas safety","landlord","record","pdf"],
      a:"HomeLinq Pro generates full Gas Safety Records (CP12) that match the industry standard format. Add appliances with make, model, type, flue type and location - the system remembers what you enter so you and other engineers can search from it next time. Download as a professional PDF with your logo and signature." },
    { id:"jobsheet", tags:["job","sheet","calendar","schedule","booking","diary"],
      a:"The Job Sheet is your daily calendar. Add jobs with customer, time, type and address. Accept marketplace jobs and direct requests. Track job status, mark complete, and convert to invoices." },
    { id:"area", tags:["area","coverage","location","borough","region","service area"],
      a:"Set your service areas in Settings under Business Details. Choose from London boroughs and surrounding counties, or add custom areas. This helps HomeLinq match you with customers in your coverage zone." },
    { id:"install", tags:["install","download","app","home screen","pwa","phone","tablet"],
      a:"You can install HomeLinq Pro and Moti as apps on your phone, tablet or laptop. When prompted, tap Install or use your browser's Add to Home Screen option. Once installed, they open like a native app - no app store needed." },
    { id:"branding", tags:["logo","signature","branding","brand","upload"],
      a:"Upload your business logo and signature in Settings under Branding. They appear on certificates, invoices and quotes sent to customers. Your signature syncs across all your devices." },
    { id:"support", tags:["help","support","contact","problem","report"],
      a:"You can report a problem from your HomeLinq account, or use the messaging area to reach your engineer or HomeLinq support." }
  ]
};
