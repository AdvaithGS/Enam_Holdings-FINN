"""Builds the demo network: public/data/network.seed.json.

Every contact here is SYNTHETIC: invented names and careers, written to overlap the
demo portfolio so the Network has something to notice. Organisations are real, and
the competitor / supplier / customer links between them are ordinary public
industry structure. No real person's profile was collected to make this file.
"""
import json
from pathlib import Path

T = lambda *x: list(x)  # noqa: E731

# id, name, ticker, size, themes, group, competitors, suppliers, customers, aliases
ORGS = [
    ("reliance", "Reliance Industries", "RELIANCE", "large", T("energy"), "Reliance", [], [], [], T("RIL")),
    ("relianceretail", "Reliance Retail", None, "large", T("retail"), "Reliance", T("trent", "abfrl"), [], [], T("Reliance Retail Ventures", "Reliance Brands")),
    ("jio", "Jio Platforms", None, "large", T("telecom"), "Reliance", T("bharti"), [], [], T("Reliance Jio", "Reliance Jio Infocomm")),
    ("hdfcbank", "HDFC Bank", "HDFCBANK", "large", T("banking"), None, T("icici"), [], [], []),
    ("tcs", "Tata Consultancy Services", "TCS", "large", T("it-services"), "Tata", T("infosys"), [], [], []),
    ("bharti", "Bharti Airtel", "BHARTIARTL", "large", T("telecom"), None, T("jio"), [], [], T("Airtel")),
    ("itc", "ITC", "ITC", "large", T("fmcg"), None, T("hul"), [], [], []),
    ("lt", "Larsen & Toubro", "LT", "large", T("infrastructure"), None, [], [], [], T("L&T", "Larsen and Toubro")),
    ("sunpharma", "Sun Pharma", "SUNPHARMA", "large", T("pharma"), None, T("drreddy"), [], [], T("Sun Pharmaceutical Industries")),
    ("maruti", "Maruti Suzuki", "MARUTI", "large", T("autos"), None, [], T("motherson"), [], T("Maruti Suzuki India")),
    ("titan", "Titan", "TITAN", "large", T("jewellery", "retail"), "Tata", T("kalyan"), [], [], T("Titan Company")),
    ("bajfinance", "Bajaj Finance", "BAJFINANCE", "large", T("consumer-lending"), None, T("cholafin"), [], [], []),
    ("asianpaint", "Asian Paints", "ASIANPAINT", "large", T("paints"), None, T("berger", "birlaopus"), T("deepak"), [], []),
    ("eternal", "Eternal (Zomato)", "ETERNAL", "mid", T("quick-commerce"), None, T("swiggy"), [], [], T("Zomato", "Eternal", "Blinkit")),
    ("trent", "Trent", "TRENT", "mid", T("retail"), "Tata", T("abfrl", "relianceretail"), [], [], T("Westside", "Zudio")),
    ("dixon", "Dixon Technologies", "DIXON", "mid", T("electronics-manufacturing"), None, T("kaynes", "syrma"), [], T("samsung"), T("Dixon Technologies (India)")),
    ("kaynes", "Kaynes Technology", "KAYNES", "small", T("electronics-manufacturing", "semiconductors"), None, T("dixon", "syrma"), T("micron"), T("maruti"), T("Kaynes Technology India", "Kaynes Semicon")),
    ("cgpower", "CG Power", "CGPOWER", "mid", T("electricals", "semiconductors"), "Murugappa", T("tataelectronics"), [], [], T("CG Power and Industrial Solutions", "CG Semi", "Axiro Semiconductor")),
    ("srf", "SRF", "SRF", "mid", T("specialty-chemicals"), None, T("navin", "deepak"), [], T("piind"), []),
    ("deepak", "Deepak Nitrite", "DEEPAKNTR", "mid", T("specialty-chemicals"), None, T("aarti", "srf"), [], T("piind", "asianpaint"), T("Deepak Chem Tech")),
    ("creditacc", "CreditAccess Grameen", "CREDITACC", "small", T("rural-lending"), None, T("fusion", "bandhan"), T("hdfcbank"), [], T("Grameen Koota")),
    ("paytm", "Paytm", "PAYTM", "mid", T("fintech"), None, T("phonepe"), [], [], T("One 97 Communications", "One97")),
    ("piind", "PI Industries", "PIIND", "mid", T("specialty-chemicals", "agrochemicals"), None, T("upl"), T("srf", "deepak"), [], []),
    ("ideaforge", "ideaForge", "IDEAFORGE", "small", T("drones"), None, [], [], [], T("Ideaforge Technology")),
    ("hul", "Hindustan Unilever", None, "large", T("fmcg"), None, T("itc"), [], [], T("HUL")),
    ("infosys", "Infosys", None, "large", T("it-services"), None, T("tcs"), [], [], []),
    ("icici", "ICICI Bank", None, "large", T("banking"), None, T("hdfcbank"), [], [], []),
    ("navin", "Navin Fluorine", None, "small", T("specialty-chemicals"), None, T("srf"), [], [], T("Navin Fluorine International")),
    ("aarti", "Aarti Industries", None, "mid", T("specialty-chemicals"), None, T("deepak"), [], [], []),
    ("syrma", "Syrma SGS", None, "small", T("electronics-manufacturing"), None, T("kaynes", "dixon"), [], [], T("Syrma SGS Technology")),
    ("tataelectronics", "Tata Electronics", None, "mid", T("semiconductors", "electronics-manufacturing"), "Tata", T("cgpower"), [], [], []),
    ("micron", "Micron India", None, "mid", T("semiconductors"), None, [], [], T("kaynes"), T("Micron Technology")),
    ("fusion", "Fusion Finance", None, "small", T("rural-lending"), None, T("creditacc"), [], [], T("Fusion Micro Finance")),
    ("bandhan", "Bandhan Bank", None, "mid", T("rural-lending", "banking"), None, T("creditacc"), [], [], []),
    ("nabard", "NABARD", None, "mid", T("rural-lending"), None, [], [], [], []),
    ("cholafin", "Cholamandalam Finance", None, "mid", T("rural-lending", "consumer-lending"), "Murugappa", T("bajfinance"), [], [], T("Cholamandalam Investment and Finance")),
    ("tubeinv", "Tube Investments", None, "mid", T("electricals"), "Murugappa", [], [], [], T("Tube Investments of India", "TII")),
    ("berger", "Berger Paints", None, "mid", T("paints"), None, T("asianpaint"), [], [], []),
    ("birlaopus", "Birla Opus (Grasim)", None, "mid", T("paints"), None, T("asianpaint"), [], [], T("Grasim Industries", "Birla Opus")),
    ("swiggy", "Swiggy", None, "mid", T("quick-commerce"), None, T("eternal"), [], [], T("Swiggy Instamart")),
    ("abfrl", "Aditya Birla Fashion", None, "mid", T("retail"), None, T("trent"), [], [], T("Aditya Birla Fashion and Retail", "ABFRL")),
    ("kalyan", "Kalyan Jewellers", None, "mid", T("jewellery"), None, T("titan"), [], [], []),
    ("motherson", "Samvardhana Motherson", None, "large", T("autos"), None, [], [], T("maruti"), T("Motherson")),
    ("samsung", "Samsung India", None, "large", T("electronics-manufacturing"), None, [], T("dixon"), [], T("Samsung India Electronics")),
    ("phonepe", "PhonePe", None, "mid", T("fintech"), None, T("paytm"), [], [], []),
    ("drreddy", "Dr. Reddy's", None, "large", T("pharma"), None, T("sunpharma"), [], [], T("Dr Reddys Laboratories")),
    ("upl", "UPL", None, "large", T("agrochemicals"), None, T("piind"), T("srf"), [], []),
    ("tatasons", "Tata Sons", None, "mid", T("retail"), "Tata", [], [], [], []),
    ("mckinsey", "McKinsey & Company", None, "mid", [], None, [], [], [], T("McKinsey")),
    ("kotakie", "Kotak Institutional Equities", None, "small", [], None, [], [], [], T("Kotak Securities")),
    ("crisil", "CRISIL", None, "mid", [], None, [], [], [], T("CRISIL Ratings")),
    ("northlight", "Northlight Capital", None, "small", [], None, [], [], [], []),
    ("mod", "Ministry of Defence", None, "large", T("drones"), None, [], [], T("ideaforge"), T("Indian Air Force")),
]
# unlisted businesses that sit inside a listed parent
PARENT = {"relianceretail": "reliance", "jio": "reliance"}
THEMES = {
    "specialty-chemicals": "Specialty chemicals", "rural-lending": "Rural lending", "semiconductors": "Semiconductors",
    "electronics-manufacturing": "Electronics manufacturing", "retail": "Retail", "paints": "Paints", "pharma": "Pharma",
    "it-services": "IT services", "telecom": "Telecom", "banking": "Banking", "fintech": "Fintech", "autos": "Autos",
    "fmcg": "Consumer staples", "quick-commerce": "Quick commerce", "infrastructure": "Infrastructure", "energy": "Energy",
    "jewellery": "Jewellery", "consumer-lending": "Consumer lending", "agrochemicals": "Agrochemicals",
    "drones": "Drones & defence", "electricals": "Electricals",
}
# Concepts: what a query can mean. `terms` are the words people actually type;
# `inputs` are the concepts that supply this one, so "suppliers to X" is a graph step.
CONCEPTS = [
    ("ev", "Electric vehicles", T("ev", "electric vehicle", "e-mobility", "electric car", "electric two-wheeler"), T("autos"), T("battery", "chips", "ems")),
    ("battery", "Battery cells", T("battery", "cell manufacturer", "lithium ion", "gigafactory", "energy storage"), [], T("battery-materials")),
    ("battery-materials", "Battery materials", T("cathode", "anode", "electrolyte", "lithium salt", "fluorochemical", "fluorine", "lipf6", "battery chemical"), T("specialty-chemicals"), []),
    ("chips", "Semiconductors", T("semiconductor", "chip", "osat", "fab", "wafer", "chip packaging", "assembly and test"), T("semiconductors"), []),
    ("ems", "Electronics manufacturing", T("ems", "electronics manufacturing", "contract manufacturing", "pcb", "box build", "electronics assembly"), T("electronics-manufacturing"), T("chips")),
    ("chem", "Specialty chemicals", T("specialty chemical", "speciality chemical", "chemical", "intermediate", "refrigerant", "phenol", "fluoro"), T("specialty-chemicals"), []),
    ("agchem", "Agrochemicals", T("agrochemical", "crop protection", "pesticide", "agri input"), T("agrochemicals"), T("chem")),
    ("microfinance", "Rural lending", T("microfinance", "mfi", "rural lending", "rural credit", "village lending", "joint liability", "borrower stress"), T("rural-lending"), T("bank-funding")),
    ("bank-funding", "Bank funding", T("bank", "banking", "wholesale funding", "credit risk", "treasury"), T("banking"), []),
    ("consumer-credit", "Consumer lending", T("consumer loan", "personal loan", "nbfc", "unsecured credit", "collections"), T("consumer-lending"), T("bank-funding")),
    ("autos", "Autos", T("auto", "car", "passenger vehicle", "automobile", "oem"), T("autos"), T("ems", "chips")),
    ("paints", "Paints", T("paint", "coating", "decorative", "dealer channel"), T("paints"), T("chem")),
    ("retail", "Retail", T("retail", "apparel", "fashion", "store", "merchandising", "fast fashion"), T("retail"), []),
    ("jewellery", "Jewellery", T("jewellery", "jewelry", "gold", "studded"), T("jewellery"), []),
    ("pharma", "Pharma", T("pharma", "drug", "generic", "usfda", "fda inspection", "regulatory affairs"), T("pharma"), T("chem")),
    ("it", "IT services", T("it service", "software service", "outsourcing", "bfsi tech"), T("it-services"), []),
    ("telecom", "Telecom", T("telecom", "5g", "spectrum", "mobile network", "arpu"), T("telecom"), []),
    ("fintech", "Fintech", T("fintech", "payment", "upi", "wallet", "payments bank"), T("fintech"), []),
    ("qcom", "Quick commerce", T("quick commerce", "food delivery", "dark store", "instant delivery"), T("quick-commerce"), []),
    ("fmcg", "Consumer staples", T("fmcg", "consumer staple", "packaged food", "brand"), T("fmcg"), []),
    ("infra", "Infrastructure", T("infrastructure", "epc", "construction", "order book", "hydrocarbon project"), T("infrastructure"), []),
    ("drones", "Drones and defence", T("drone", "uav", "defence", "defense", "unmanned"), T("drones"), []),
    ("electricals", "Electricals", T("motor", "transformer", "switchgear", "electrical"), T("electricals"), []),
]

SCHOOLS = [("iitk", "IIT Kanpur", ["Indian Institute of Technology Kanpur", "IIT-K"], "large"),
           ("iima", "IIM Ahmedabad", ["Indian Institute of Management Ahmedabad", "IIM-A", "IIMA"], "small"),
           ("iimb", "IIM Bangalore", ["Indian Institute of Management Bangalore", "IIMB"], "small"),
           ("iitb", "IIT Bombay", ["Indian Institute of Technology Bombay"], "large"),
           ("iitm", "IIT Madras", ["Indian Institute of Technology Madras"], "large"),
           ("ict", "ICT Mumbai", ["Institute of Chemical Technology", "UDCT"], "small"),
           ("srcc", "SRCC Delhi", ["Shri Ram College of Commerce"], "large"),
           ("icai", "ICAI", ["Institute of Chartered Accountants of India", "Chartered Accountant"], "large"),
           ("xlri", "XLRI Jamshedpur", ["XLRI"], "small"),
           ("isb", "ISB Hyderabad", ["Indian School of Business"], "small"),
           ("bits", "BITS Pilani", [], "large")]

R = lambda org, title, a, b, fn, lvl: {"org": org, "title": title, "from": a, "to": b, "fn": fn, "level": lvl}  # noqa: E731
E_ = lambda school, degree, to: {"school": school, "degree": degree, "to": to}  # noqa: E731

ME = {"id": "me", "name": "You", "headline": "Portfolio manager, Northlight Capital",
      "roles": [R("kotakie", "Research analyst", 2010, 2014, "investing", 3), R("northlight", "Portfolio manager", 2014, None, "investing", 1)],
      "education": [E_("IIT Kanpur", "B.Tech", 2006), E_("IIM Ahmedabad", "PGP", 2010)]}

# name, headline, city, roles, education, (closeness, how, since, last, note)
C = [
 ("Rhea Kapadia", "Chief merchant, Aditya Birla Fashion", "Mumbai",
  [R("trent", "Head of Merchandising, Westside", 2013, 2021, "sales", 2), R("abfrl", "Chief Merchandising Officer", 2021, None, "sales", 1)],
  [E_("XLRI Jamshedpur", "PGDM", 2008)], (2, "Met at a retail conference; three channel checks since", 2019, "2025-01", "Knows Trent's sourcing and store-opening playbook from the inside.")),
 ("Vikram Desai", "Operating partner; ex-Tata Sons group strategy", "Mumbai",
  [R("tatasons", "Vice President, Group Strategy", 2010, 2018, "strategy", 2), R("mckinsey", "Engagement manager", 2005, 2010, "strategy", 3)],
  [E_("IIM Ahmedabad", "PGP", 2005)], (3, "Mentor since your first year on the buy side", 2012, "2026-08", "Sat in on Tata retail capital-allocation reviews.")),
 ("Sandeep Kulkarni", "Sales director, Birla Opus", "Pune",
  [R("asianpaint", "Regional Sales Manager, West", 2008, 2019, "sales", 3), R("birlaopus", "Director, Sales", 2022, None, "sales", 2), R("berger", "GM Sales", 2019, 2022, "sales", 2)],
  [E_("IIM Bangalore", "PGP", 2008)], (2, "Dealer-channel checks on paints", 2020, "2026-05", "Has worked all three: Asian Paints, Berger, Birla Opus.")),
 ("Anitha Rao", "Operations advisor; ex-Kaynes", "Mysuru",
  [R("kaynes", "VP Operations", 2016, 2023, "operations", 2), R("tataelectronics", "Advisor, OSAT ramp", 2023, None, "operations", 2)],
  [E_("IIT Madras", "M.Tech", 2001)], (2, "Plant visit to Kaynes Mysuru in 2021", 2021, "2025-09", "Ran the Mysuru plant through the IPO years; knows the working-capital cycle.")),
 ("Karthik Subramanian", "CFO, Syrma SGS", "Chennai",
  [R("syrma", "Chief Financial Officer", 2020, None, "finance", 1), R("dixon", "Financial Controller", 2014, 2020, "finance", 2)],
  [E_("ICAI", "CA", 2006)], (2, "Introduced by a common auditor friend", 2021, "2026-06", "Sees EMS pricing and customer credit terms across the sector.")),
 ("Deepa Nair", "Programme lead, Tata Electronics", "Bengaluru",
  [R("tataelectronics", "Programme Lead, Semiconductor Assembly", 2022, None, "technology", 2), R("micron", "Senior Process Engineer", 2015, 2022, "technology", 3)],
  [E_("IIT Kanpur", "B.Tech", 2007)], (2, "IIT Kanpur, a year junior; same hall", 2003, "2026-02", "Hands-on with OSAT yields and tool lead times.")),
 ("Rohan Bhatia", "Director of supply chain, Micron India", "Ahmedabad",
  [R("micron", "Director, Supply Chain", 2021, None, "operations", 2), R("samsung", "Senior Manager, Sourcing", 2013, 2021, "operations", 3)],
  [E_("BITS Pilani", "B.E.", 2009), E_("ISB Hyderabad", "PGP", 2013)], (1, "Panel together at a semiconductor forum", 2024, "2025-12", None)),
 ("Suresh Gowda", "Business head (South), Fusion Finance", "Bengaluru",
  [R("creditacc", "Regional Head, Karnataka", 2012, 2020, "sales", 2), R("fusion", "Business Head, South", 2020, None, "sales", 2)],
  [], (2, "Field trip to Karnataka branches in 2018", 2018, "2024-11", "Reads borrower stress in Karnataka a quarter before it shows in filings.")),
 ("Farah Sheikh", "Deputy general manager, NABARD", "Mumbai",
  [R("nabard", "Deputy General Manager, Microfinance", 2011, None, "risk", 2)],
  [E_("SRCC Delhi", "B.Com", 2004)], (1, "Met at an RBI financial-inclusion roundtable", 2023, "2026-03", None)),
 ("Manoj Tiwari", "Head of MFI lending, HDFC Bank", "Mumbai",
  [R("hdfcbank", "Head, Microfinance Institution Lending", 2017, None, "risk", 2), R("icici", "Credit Manager", 2009, 2017, "risk", 3)],
  [E_("IIM Ahmedabad", "PGP", 2009)], (2, "IIM-A, a batch senior", 2008, "2026-07", "Decides how much banks lend to microfinance companies.")),
 ("Hemant Joshi", "Consultant; ex-SRF plant head", "Vadodara",
  [R("srf", "Plant Head, Fluorochemicals, Dahej", 2005, 2019, "operations", 2), R("navin", "Technical Advisor", 2019, 2023, "operations", 2)],
  [E_("ICT Mumbai", "B.Chem.Engg", 1996)], (2, "Expert call in 2020; kept in touch", 2020, "2025-03", "Knows refrigerant-gas economics and what a capex announcement really takes to commission.")),
 ("Priya Venkataraman", "Head of procurement, PI Industries", "Gurugram",
  [R("piind", "Head, Strategic Procurement", 2018, None, "operations", 2), R("upl", "Sourcing Manager", 2010, 2018, "operations", 3)],
  [E_("ICT Mumbai", "B.Tech", 2006), E_("IIM Bangalore", "PGP", 2010)], (2, "Introduced by Shruti", 2022, "2026-09", "Buys intermediates from SRF and Deepak Nitrite; sees their pricing first.")),
 ("Nikhil Shah", "CFO, Aarti Industries", "Mumbai",
  [R("aarti", "Chief Financial Officer", 2021, None, "finance", 1), R("navin", "Head of Finance", 2014, 2021, "finance", 2)],
  [E_("ICAI", "CA", 2005)], (1, "Investor day conversation", 2023, "2026-01", None)),
 ("Gaurav Sethi", "Sourcing head, Samsung India", "Noida",
  [R("samsung", "Head, Contract Manufacturing", 2018, None, "operations", 2), R("dixon", "Key Account Manager", 2012, 2018, "sales", 3)],
  [E_("IIT Kanpur", "B.Tech", 2006)], (3, "IIT Kanpur batchmate", 2002, "2026-10", "On the customer side of Dixon's largest contracts.")),
 ("Meera Iyer", "Chief credit officer (retail), ICICI Bank", "Mumbai",
  [R("hdfcbank", "Senior VP, Retail Credit Risk", 2009, 2020, "risk", 2), R("icici", "Chief Credit Officer, Retail", 2020, None, "risk", 1)],
  [E_("IIM Ahmedabad", "PGP", 2009)], (2, "IIM-A alumni circle", 2011, "2025-06", "Built HDFC Bank's unsecured-loan scorecards.")),
 ("Aditya Pandey", "Founder, a collections-analytics startup", "Pune",
  [R("bajfinance", "National Head, Collections Analytics", 2015, 2022, "risk", 2)],
  [E_("IIT Bombay", "B.Tech", 2010)], (1, "Pitched his startup to you", 2023, "2026-04", None)),
 ("Tanvi Agarwal", "Category head, Reliance Retail", "Mumbai",
  [R("relianceretail", "Category Head, Fashion & Lifestyle", 2019, None, "sales", 2), R("trent", "Buyer, Zudio", 2015, 2019, "sales", 3)],
  [E_("IIM Ahmedabad", "PGP", 2010)], (3, "IIM-A batchmate, same section", 2008, "2026-10", "Was on the founding buying team at Zudio.")),
 ("Imran Qureshi", "Finance director, Bharti Airtel", "Gurugram",
  [R("jio", "General Manager, Finance", 2016, 2022, "finance", 2), R("bharti", "Director, Business Finance", 2022, None, "finance", 2)],
  [E_("ICAI", "CA", 2008)], (2, "Ex-colleague's brother-in-law; two long lunches", 2021, "2025-02", "Worked on Jio's 2020 fund-raise numbers.")),
 ("Kabir Malhotra", "City GM, Swiggy Instamart", "Bengaluru",
  [R("eternal", "City Head, Bengaluru", 2018, 2022, "operations", 3), R("swiggy", "General Manager, Instamart", 2022, None, "operations", 2)],
  [E_("ISB Hyderabad", "PGP", 2018)], (1, "Quick-commerce dark-store visit", 2024, "2026-06", None)),
 ("Sneha Reddy", "Compliance lead, PhonePe", "Bengaluru",
  [R("paytm", "AVP, Payments Compliance", 2017, 2023, "legal", 2), R("phonepe", "Director, Regulatory Compliance", 2023, None, "legal", 2)],
  [], (2, "Helped you read the RBI order on Paytm Payments Bank", 2024, "2025-08", "Knows how regulator conversations at Paytm actually run.")),
 ("Alok Banerjee", "Regulatory consultant; ex-Sun Pharma", "Vadodara",
  [R("sunpharma", "Head, US Regulatory Affairs", 2008, 2021, "legal", 2), R("drreddy", "Advisor, Quality", 2021, 2024, "legal", 2)],
  [], (2, "Expert call on a USFDA inspection", 2019, "2025-10", "Has sat through US FDA inspections at Halol.")),
 ("Harpreet Sandhu", "Key-account director, Motherson", "Gurugram",
  [R("motherson", "Director, Key Accounts (Maruti Suzuki)", 2014, None, "sales", 2)],
  [], (1, "Auto-ancillary conference", 2022, "2026-02", None)),
 ("Rajesh Pillai", "Independent advisor; ex-L&T", "Chennai",
  [R("lt", "Project Director, Hydrocarbon", 2001, 2020, "operations", 2)],
  [], (2, "Your uncle's former colleague", 2015, "2025-11", "Knows how L&T books and executes Gulf orders.")),
 ("Lakshmi Narayanan", "Delivery head (BFSI), Infosys", "Bengaluru",
  [R("tcs", "Delivery Head, BFSI North America", 2006, 2019, "technology", 2), R("infosys", "SVP, Financial Services", 2019, None, "technology", 1)],
  [], (1, "Sell-side hosted dinner", 2022, "2026-05", None)),
 ("Devika Menon", "Marketing director, Hindustan Unilever", "Mumbai",
  [R("itc", "Brand Manager, Foods", 2011, 2017, "sales", 3), R("hul", "Marketing Director, Foods", 2017, None, "sales", 2)],
  [E_("IIM Ahmedabad", "PGP", 2011)], (2, "IIM-A, a batch junior", 2010, "2026-09", None)),
 ("Sameer Khanna", "Telecom consultant; ex-Airtel", "Gurugram",
  [R("bharti", "VP, Network Planning", 2009, 2021, "technology", 2)],
  [], (1, "Expert call on 5G capex", 2022, "2024-12", None)),
 ("Pooja Bansal", "Merchandising head, Kalyan Jewellers", "Thrissur",
  [R("kalyan", "Head of Merchandising", 2019, None, "sales", 2), R("titan", "Category Manager, Tanishq", 2012, 2019, "sales", 3)],
  [], (2, "Jewellery-channel checks every Akshaya Tritiya", 2020, "2026-04", "Tracks Tanishq's studded mix and gold-exchange schemes.")),
 ("Ankit Jain", "Fund manager, a domestic mutual fund", "Mumbai",
  [R("kotakie", "Research analyst", 2010, 2016, "investing", 3)],
  [E_("SRCC Delhi", "B.Com", 2007), E_("ICAI", "CA", 2009)], (3, "Shared a desk at Kotak for four years", 2010, "2026-11", None)),
 ("Shruti Deshpande", "Partner, McKinsey (chemicals)", "Mumbai",
  [R("mckinsey", "Partner, Chemicals & Agriculture", 2010, None, "strategy", 1)],
  [E_("ICT Mumbai", "B.Tech", 2006), E_("IIM Ahmedabad", "PGP", 2010)], (3, "IIM-A batchmate", 2008, "2026-10", "Has advised most Indian specialty-chemical boards.")),
 ("Varun Saxena", "Director, CRISIL Ratings", "Mumbai",
  [R("crisil", "Director, Financial Sector Ratings", 2012, None, "risk", 2)],
  [E_("IIT Kanpur", "B.Tech", 2006)], (2, "IIT Kanpur batchmate", 2002, "2026-01", "Rates microfinance lenders and NBFCs.")),
 ("Venkat Raman", "Strategy head, Tube Investments", "Chennai",
  [R("tubeinv", "Head of Strategy & M&A", 2017, None, "strategy", 2), R("cholafin", "Corporate Planning Manager", 2011, 2017, "strategy", 3)],
  [E_("IIM Bangalore", "PGP", 2011)], (1, "Met when Murugappa bought CG Power", 2021, "2025-05", "Worked on the CG Power turnaround plan.")),
 ("Ishita Roy", "Sales head, an industrial motors firm", "Kolkata",
  [R("cgpower", "National Sales Head, Motors", 2014, 2022, "sales", 2)],
  [], (1, "Channel check on industrial motors", 2023, "2026-03", None)),
 ("Ajay Thakur", "Defence procurement advisor; retired Wing Commander", "New Delhi",
  [R("mod", "Wing Commander, UAV procurement", 2004, 2021, "operations", 2)],
  [], (1, "Introduced at a defence-tech demo day", 2024, "2026-07", "Ran UAV trials; knows what the forces actually order.")),
 ("Nandini Krishnan", "Independent director; ex-HDFC Bank treasurer", "Mumbai",
  [R("hdfcbank", "Group Head, Treasury", 2004, 2018, "finance", 1), R("bandhan", "Independent Director", 2020, None, "board", 1)],
  [E_("IIM Ahmedabad", "PGP", 1994)], (2, "Family friend", 2009, "2026-06", "Sits on boards; reads management quality well.")),
]


def main():
    contacts = []
    for n, (name, headline, city, roles, edu, tie) in enumerate(C, 1):
        contacts.append({"id": f"c{n:02d}", "name": name, "headline": headline, "city": city, "roles": roles, "education": edu,
                         "tie": {"closeness": tie[0], "how": tie[1], "since": tie[2], "last": tie[3], **({"note": tie[4]} if tie[4] else {})}})
    ids = {o[0] for o in ORGS}
    for c in contacts + [ME]:
        for r in c["roles"]:
            assert r["org"] in ids, r
    orgs = []
    for oid, name, ticker, size, themes, group, comp, sup, cust, aliases in ORGS:
        for x in comp + sup + cust:
            assert x in ids, (oid, x)
        o = {"id": oid, "name": name, "size": size, "themes": themes}
        if oid in PARENT:
            o["parent"] = PARENT[oid]
        for k, v in (("ticker", ticker), ("group", group), ("competitors", comp), ("suppliers", sup), ("customers", cust), ("aliases", aliases)):
            if v:
                o[k] = v
        orgs.append(o)
    net = {"synthetic": True, "me": ME, "contacts": contacts, "orgs": orgs,
           "schools": [{"id": i, "name": n, "aliases": a, "cohort": c} for i, n, a, c in SCHOOLS],
           "themes": [{"id": k, "label": v} for k, v in THEMES.items()],
           "concepts": [{"id": i, "label": l, "terms": t, "themes": th, "inputs": inp} for i, l, t, th, inp in CONCEPTS]}
    cids = {c[0] for c in CONCEPTS}
    assert all(i in cids for c in CONCEPTS for i in c[4]) and all(t in THEMES for c in CONCEPTS for t in c[3])
    out = Path(__file__).resolve().parent.parent / "public" / "data" / "network.seed.json"
    out.write_text(json.dumps(net, ensure_ascii=False, indent=1))
    print(f"{len(contacts)} contacts, {len(orgs)} organisations -> {out}")


if __name__ == "__main__":
    main()
