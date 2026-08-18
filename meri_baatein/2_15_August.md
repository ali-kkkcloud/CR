# Cautio CRM — aapke saare messages

Is chat ke shuru se (11 August 2026) aaj tak, **word to word**, waqt ke saath.
Saare times **IST** me hain. System ke auto-generated summaries aur tool notifications
hata diye gaye hain — sirf wahi hai jo aapne khud likha.

**Kul 56 messages · 11 August 2026 se 18 August 2026 tak**

---


## 15 August 2026, Saturday

### 19. 05:52 AM

> Try again

### 20. 07:16 AM

> saari cheeze sai hena??? kuch bhi issue nhii hogana? and mjhe ye batao agr auto break ho gya kuch update nh krne ki wajah se and uska shift ka time khtm ho gya to next day tk on break hi rhega kya?

### 21. 07:29 AM

> issues fix krne k baad pull nhi hua? and agr tum chaaho to me sheet ka access bhi de deta hu taake real time pr cheeze test kr sko, sara test ho jayga to zyada achha rhega, or kisi cheez ka access chahiye ho to bhi btatao

### 22. 07:36 AM

> live sheet pr hi deta hu me access wohi best rhega... and me mere employees ko bol chuka hu abhi test ho rha h koi kuch bhi nhii krega, and test employee bnaane ki zaroorat nhi h, jo already employees hn unhi k credentil use kro unhi se test kro.. bilkul real time test kro and saare bugs dhooondo.... kitni der me test complete ho jaayga? and kis kis ka acess dedo ye btaao and access du kese ye bhi batao

### 23. 08:48 AM

> BRINDA  — wo 07:42 pe login hui to uske pass clients kyu nhi aay?

### 24. 09:09 AM

> 12:00 shift, 08:53 pe login kra to clients ana chahiyena yr. koi bewkoof thodi h jo khali bethega, mera wo logic sahi hena 30 tk koi aya uske liye kya hoga, ya 31 se aya uske liye kya hoga...
> kyu k every time hardcoding kr kr k employees ka shift thodi dalenge... and mjhe ye bhi batao k clients or add krna ho to kaha kru?

### 25. 11:21 AM

> auto merge ho rha h kya? kyu k pull request nhi arhi mere pass... and mene ye bola h employees ka timing hardcode nhi krna... fr bhi tum hardcode kr rhe ho...

### 26. 11:29 AM

> Fr inka kyaa hoga??
> BRINDA ke fixed clients (hour 8 = CF-Mumbai, 9 = CF-Chennai/CF-Delhi, 10 = CF-Hyderabad, 11 = CF-Kolkata)
> BRINDA ke CALL hours (12–18), Shashi ka "Infants OFFLINE Calling", HARI ka "OFFLINE REPORTS"
> Hariprasad ke raat ke fixed clients

### 27. 11:53 AM

> ek baar firse live test krlo, and saari conditions check krlo, saare edge cases check krlo, bilkul perfect hona chahiye koi bhi bugs nhii hona chahiye,

### 28. 01:30 PM

> mere employees 20 h around ho jaaynge, ya ho skta h 25 employees ho jaay... mjhe bht strong platform chahiye taake issue naa de.
> 
> Abhi current me ye employees and ye timings hn...
> 
>     name:"Sunil",      start:7,  end:16,
>     name:"Mahesh",     start:7,  end:16,
>     name:"GUNASAGARI", start:8,  end:17,
>     name:"Nikita",     start:8,  end:17,
>     name:"Nesiya",     start:8,  end:17,
>     name:"Ritanjali",  start:8,  end:17,
>     name:"BRINDA",     start:8,  end:17,
>     name:"Darshan",    start:10, end:19,
>     name:"Afzal",      start:12, end:21,
>     name:"Shashi",     start:12, end:21,
>     name:"Naveen",     start:12, end:21,
>     name:"Rakesh",     start:12, end:21,
> 
> NightShift:-
> 
>     name:"Kiran",      start:21, end:6,
>     name:"Yunus",      start:21, end:6,  
>     name:"CHANDAN",    start:21, end:6,
>     name:"MANTU",      start:22, end:7, 
>     name:"HARI",       start:22, end:7, 
>     name:"RISHI",      start:21, end:6, 
> 
> 
> 
> and ye mene mere clients diye h... ye saare clients and unki timings hn... koi single bhi miss nhii hona chahiye....
> const CLIENT_TIMINGS = {
>   
> 
>   
>   //--------------FOR ALL DAYS-----------------
> 
> 
> 
> 
>   "Eden Green Energy": [9, 13, 17, 19, 22,],
>   "Vijaylaxmi Travels": [9, 17, 19, 21, 23, 1, 4],
>   "Shoffr_Delhi": [8, 13, 17, 20, 22, 0, 2, 4],
>   "Shoffr_Hyderabad": [8, 13, 17, 20, 22, 0, 2, 4],
>   "Shoffr_Bangalore": [5, 12, 1],
>   "Versatile Pvt Ltd": [8, 12, 17, 19, 21, 23, 1, 4],
>   "Power Move": [9, 11, 13, 15, 17, 18, 20, 22, 0, 2, 4],
>   "Routematic_Bangalore": [8, 13, 16, 20, 22, 0, 2, 4],
>   "Routematic_Chennai": [8, 13, 16, 20, 22, 0, 2, 4],
>   "Routematic_Goa": [8, 13, 16, 20, 22, 0, 2, 4],
>   "Routematic_Mumbai": [8, 13, 16, 20, 22, 0, 2, 4],
>   "Ashok Bus Service": [8, 10, 14, 16, 18, 22, 0, 2, 4],
>   "Shree Sairam Travels": [8, 13, 17, 20, 22, 0, 2, 4],
>   "Ashray Travels": [9, 13, 16, 21, 23, 2, 5],
>   "Shreyas Travels Aurangabad": [8, 13, 16, 21, 23, 2, 5],
>   "Deepak Raj Bus service": [8, 13, 14, 16, 21, 23, 2, 5],
>   "Navneet Travels": [9, 13, 17, 19, 21, 23, 2, 5],
>   "Ashok Travels": [8,  14, 16, 18, 21, 23, 2, 5],
>   "Shree Saroj Travels": [8, 14, 16, 18, 21, 23, 2, 5],
>   "Choudhary Tours and Travels": [8, 14, 18,  21, 23, 2, 5],
>   "Sanjay Travels Nagpur": [8, 14, 18, 20, 22, 0, 3, 5],
>   "Bac Cabs": [10, 14, 16, 18, 20, 22, 0, 3, 5],
>   "DNR Express": [8, 14, 16, 18, 20, 0, 3, 5],
>   "Sindh Radhe Travels": [8, 13, 15, 18, 22, 1, 3, 5],
>   "Ram Tours and Travels": [9,  17, 19, 22, 1, 3, 5],
>   "Citizen Travels Indore": [8, 12, 14, 18, 20, 22, 1, 3, 5],
>   "Citizen Travels Bombay": [8, 12, 14, 21, 0, 3, 6],
>   "Shree Ganesh Travels": [9, 14, 15, 17, 18, 21, 0, 3, 6],
>   "Jogeshwari Enterprises": [9, 12, 17, 19, 21, 0, 3, 6],
>   "Indumati Travels": [9, 12, 17, 19, 22, 1, 4, 6],
>   "Pooja Travels Nagpur": [9, 12, 17, 19, 22, 1, 4, 6],
>   "Leafy Bus": [10, 16, 21, 23, 1,3, 5], 
>   "SaarthiEV": [8, 13, 16, 18, 20, 22, 1, 4, 6],
>   "Euro Cars- Chennai": [10, 14, 17, 20, 23, 1, 3, 6],
>   "Euro Cars- Kolkata": [9, 13, 17, 19, 23, 1, 3, 6],
>   "Euro Cars- Mumbai": [7, 9, 13, 15, 19, 23, 1, 3],
>   "Euro Cars- Delhi": [8, 12, 15, 19, 0, 2, 4],
>   "Euro Cars- Bangalore": [9, 12, 14, 19, 0, 2, 4],
>   "Euro Cars- Hyderabad": [9, 12, 14, 19, 0, 2, 4, 6],
>   "Euro Cars_Pune": [9, 12, 14, 19, 0, 2, 4, 6],
>   "Green Drive Mobility": [7, 14, 20, 2, 4],
>   "Prasanna Purple Mobility Solutions": [9, 13, 17, 21, 23, 1, 4],
>   "Kundan Travels": [8, 11, 13, 17, 21, 23, 0, 1, 2, 3, 4, 5],
>   "Nura Electric Mobility": [10, 13, 19, 23],
>   "Eco Mobility": [8, 10, 13, 14, 16, 19, 21, 23, 1, 4],
>   "SAP infralogistics": [11, 13, 17, 21, 23, 1, 4],
>   "Switch Labs": [9, 13, 16, 21, 23, 1, 4],
>   "BABA travels": [11, 13, 17, 21, 23, 1, 4],
>   "Royal Travels Nagpur": [8, 13, 17, 21, 23, 1, 4],
>   "Royal Travels Amravati": [9, 13, 17, 21, 23, 1, 4],
>   "Gola Bus Service": [10, 13, 17, 21, 23, 1, 4],
>   "A TO Z Cab Services": [11, 13, 17, 21, 23, 1, 4],
>   "Chulbul Bus Service": [8, 13, 17, 21, 23, 1, 4],
>   "Manish Travels Durg": [9, 13, 17, 21, 23, 1, 4],
>   "PSS Transport": [10, 13, 16, 21, 23, 1, 4],
>   "Zelssy": [8, 13, 17, 21, 23, 1, 4],
>   "SAAM Tours and Travels": [9, 13, 17, 22, 0, 2, 4],
>   "RR TRAVELS": [10, 13, 17, 22, 0, 2, 4],
>   "GRT": [9, 13, 16, 19, 22, 0, 2, 4],
>   "Naveen Travels": [8, 13, 17, 22, 0, 2, 4],
>   "National travels": [9, 17, 22, 0, 2, 4],
>   "Balaji Cabs": [8, 13, 17, 22, 0, 2, 4],
>   "MANOJ TOURS AND TRAVELS": [10, 13, 17, 22, 0, 2, 4],
>   "SHIV SAI TRAVEL AGENCY": [11, 13, 17, 22, 0, 2, 4],
>   "Turbotork Technologies": [9, 12, 17, 18, 20, 22, 0, 2, 4],
>   "Apple Bus": [11, 17, 18, 22, 0, 2, 4],
>   "Igus": [8, 14, 17, 20, 0, 2, 4],
>   "Agni travels": [11, 14, 18, 21, 23, 2, 5],
>   "Mettur super service": [10, 12, 16, 21, 23, 2, 5],
>   "Vinoth Travels": [11, 13, 16, 21, 23, 2, 5],
>   "Nandi Mobility": [11, 12, 16, 21, 23, 2, 5],
>   "Sri Vaari Travels": [9, 12, 16, 19, 21, 23, 2, 5],
>   "Athena": [10, 19, 23, 2, 5],
>   "Drivonaut": [9, 11, 13, 16, 19, 21, 23, 2, 5],
>   "TRANSBOOK INDIA LLP": [8, 12, 16, 19, 21, 23, 2, 5],
>   //"Venture Transport Services": [],
>   "KRS Travels": [8, 12, 15, 19, 21, 23, 2, 5],
>   "Biyani Travels": [10, 12, 15, 19, 21, 23, 2, 5],
>   "VKV Travels": [11, 15, 19, 21, 23, 2, 5],
>   "Lion travels": [11, 15, 19, 22, 0, 2, 5],
>   "Mr.Holidays": [10, 12, 15, 19, 21, 23, 2,3,4, 5, 6],
>   //"Yuga Travels": [],
>   "Cumbum Travels": [8, 12, 15, 19, 22, 0, 3, 5],
>   "Starline": [10, 12, 15, 19, 22, 0, 3, 5],
>   "Instant Panthers": [8, 12, 15, 19, 22, 0, 3, 5],
>   "PSR TRAVELS": [10, 12, 15, 19, 22, 0, 3, 5],
>   "Shri Abinesh Roadways": [10, 12, 15, 19, 22, 0, 3, 5],
>   "ATMARAM TRAVELS": [7, 12, 15, 19, 22, 0, 3, 5],
>   "Sri Ram Cargo": [10, 12, 15, 19, 1, 3, 5],
>   "DFC Logistics_Cargo": [9, 11, 13, 15, 19, 22, 1, 3, 5],
>   "Ashwini Tours Travels": [8, 12, 15, 19, 22, 1, 3, 5],
>   "SST Limoliner": [9, 12, 15, 19, 22, 1, 3, 5],
>   "Kohinoor Tours and Travels": [10, 12, 15, 19, 22, 1, 3, 5],
>   "Anand Bus Transport": [8, 12, 15, 19, 22, 1, 3, 5],
>   "KARTHIKEYA TOURS AND TRAVELS": [7, 12, 15, 19, 21, 0, 3, 5],
>   "BARDE ROADLINES": [9, 12, 15, 19, 21, 0, 3, 5],
>   "Nakoda Travels Kolhapur": [8, 12, 15, 19, 21, 0, 3, 5],
>   "Nakoda Travels Sangli": [9, 12, 15, 19, 21, 0, 3, 5],
>   "Indo Canadian Transport Co Private Limited": [9, 12, 18, 20, 22, 0, 3, 5],
>   "AKANKSHA TOURISM": [7, 12, 14, 18, 21, 0, 2, 4],
>   "Mr.Holidays": [9, 12, 14, 18,  21, 0, 2, 4],
>   "Surakshith Fleet": [10, 13, 15, 18, 22, 3,],
>   "Expo Logistics": [9, 14, 18, 21, 0, 3, 5],
>   "VINAYAGA SELVAM TRAVELS": [10, 12, 14, 18, 20, 22, 1, 4, 6],
>   "JB Connect": [9, 12, 14, 18, 20, 23, 1, 4, 6],
>   "Golden Temple Volvo Bus Services": [11, 13, 18, 20, 22, 1, 4, 6],
>   "SAI ABHISHEK TRAVELS": [11, 14, 18, 20, 22, 1, 4, 6],
>   "Harwinder Enterprises": [9, 12, 14, 18, 20, 22, 1, 4, 6],
>   "Ramesh Tours and Travels": [11,  14, 16, 18, 20, 22, 1, 4, 6],
>   "FLY BUS": [7, 12, 14, 19, 22, 1, 4, 6],
>   "Tegra Express": [9, 12, 14, 19, 23, 1, 3, 5],
>   "Vasudeo Travels": [12,],
>   "Radha Vallabh Travels Rewa": [11, 14, 19, 23, 1, 3, 5],
>   //"NANDAN TRAVELS SEONI": [],
>   "MUSAFIR TRAVELS": [8, 12, 14, 19, 23, 1, 3, 5],
>   "MGK Logistics": [10, 12, 14, 19, 23, 1, 3, 5],
>   "Yashshree Travels": [11, 14, 19, 23, 1, 3, 5],
>   "SHRI SWAMINARAYAN TRAVELS": [7, 12, 14, 19, 23, 1, 3, 5],
>   "DFC Logistics_Uber": [10, 12, 14, 19, 23, 1, 3, 5],
>   "Zubins Royal Fleet": [7, 12, 14, 19, 23, 1, 3, 5],
>   "Sri Srinivasa Bus": [9, 12, 14, 19, 23, 0, 2, 4, 6],
>   "RELIANCE TRAVELS MAYILADUTHURAI": [11, 14, 19, 22, 0, 2, 4, 6],
>   "ExServiceman Logistics": [10, 12, 14, 18, 22, 0, 2, 4, 6],
>   "NKB SMART BUS PRIVATE LIMITED": [10, 12, 14, 18, 22, 0, 2, 4, 6],
>   "BLUEWORLD TOURIST Pvt Ltd": [10, 12, 14, 18, 22, 0, 2, 4, 6],
>   "Abhishek Travels": [10, 12, 14, 18, 22, 0, 2, 4, 6],
>   "MB Link": [14, ],
>   "Kartik tours and travels": [14, ],
>   "MG Transport": [9, 13, 17, 22, 0, 2, 4],
>   "EXCEL TOURS TRAVELS": [9, 13, 17, 22, 0, 2, 4],
>   "SAFAR EXPRESS TOUR & TRAVELS": [9, 13, 17, 22, 0, 2, 4],
>   "JIHAN LUXURY TRAVELS": [9, 13, 17, 22, 0, 2, 4],
>   "Sarathi X": [9, 13, 17, 22, 0, 2, 4],
>   "ROYCE LOGISTICS PRIVATE LIMITED": [9, 13, 17, 22, 0, 2, 4],
>   "Fery Rides": [7, 9, 12, 15, 18, 21, 0, 1, 3, 5, 6],
>   "New Vikas Travels": [9, 13, 17, 21, 0, 3, 5],
>   "APR Smart Ride": [9, 13, 17, 21, 0, 3, 5],
>   "Jay Jagannath Bus Service": [9, 13, 17, 21, 0, 3, 5],
>   "NEW UNITED TRAVELS": [9, 13, 17, 21, 0, 3, 5], 
>   "Breez Mobility": [7, 9, 11, 13, 17, 21, 0, 3, 5], 
>   "Manish Travels Goa": [9, 11, 13, 17, 21, 0, 3, 5],
>   "Sky Travels": [9, 11, 13, 17, 21, 0, 3, 5],
>   "Vaishali Travels": [9, 11, 13, 17, 21, 0, 3, 5],
>   "Chanakya Travels Buldhana": [9, 11, 13, 17, 21, 0, 3, 5],
>   "Fresh Bus": [7,9,11,13,15,17,19,21,23,1,3,5],
>   "Jayam Travels": [9, 11, 13, 17, 21, 0, 3, 5],
>   "Sri Vetrivel Travels": [9, 11, 13, 17, 21, 0, 3, 5],
>   "Mantra Tours and Travels": [9, 11, 13, 17, 21, 0, 3, 5],
>   "Shri Ganesh Tours and Travels Dhule": [9, 11, 13, 17, 21, 0, 3, 5],
>   "Kartik Kolhapur": [10, 12, 14, 18, 22, 0, 2, 4, 6],
> 
>   // ------------------ REDBUS Less Then 5 vehicles ----------------
> 
> 
>     "Aastha tourist and logistics": [10, 15, 18, 21, 1, 4],
>     "Sri Maruthi Travels": [9, 13, 17, 19, 22, 1, 4],
>     "Dada Brothers Raipur": [10, 13, 17, 22, 2, 5],
>     "V2K Travels": [8, 13, 17, 22, 2, 4],
>     "JAY SAI TOURS AND TRAVELS": [9, 13, 17, 22, 2, 5],
>     "Uncle Travels": [11, 14, 18, 21, 2],
>     "Alif Travels": [8, 13, 18, 20, 21, 2, 5],
>     "SJV Travels": [10, 12, 16, 21, 2, 5],
>     "Sree Varun Travels": [8, 12, 16, 19, 21, 2, 5],
>     "Aakash Travels": [9, 12, 15, 19, 21, 2, 5],
>     "SGT translink": [10, 12, 15, 19, 21, 2, 5],
>     "New Pramukhraj Travels": [11, 14, 19, 21, 2, 5],
>     "Bharmani Travels": [11, 13, 15, 19, 21, 2, 5],
>     "Golden Power Travels": [8, 12, 15, 19, 21, 2, 5],
>     "Jai Mata Di Travels": [11, 15, 19, 22, 3, 6],
>     "VHB Travels": [11, 15, 19, 22, 3, 6],
>     "Jaya Rajeshwari Travels": [9, 12, 15, 19, 22, 3, 6],
>     "Xelite Travels": [9, 11, 15, 19, 22, 3, 6],
>     "KRISHNA ENTERPRISES": [8, 12, 15, 19, 22, 1, 4],
>     "JRDELTA TOUR SERVICE PRIVATE LIMITED": [9, 12, 15, 19, 22, 1, 4],
>     "Sethi yatra company": [10, 12, 15, 19, 22, 1, 4],
>     "Anand Tours and travels Pune": [7, 12, 15, 19, 22, 1, 4],
>     "MEDIKONDA TRRAVELS": [10, 12, 15, 19, 22, 1, 4],
>     "AVLT TRANS": [8, 12, 15, 19, 21, 3, 6],
>     "Iconic Travels and Holidays": [11, 13, 15, 19, 21, 3, 6],
>     "SRI SIDDHAN TRAVELS": [10, 12, 15, 19, 21, 3, 6],
>     "BAIKUNTHA TRANSPORT SERVICE": [9, 12, 14, 18, 20, 22, 1, 3, 6],
>     "Manish Travels Bhuwasal": [11, 13, 18, 20, 22, 1,3, 6],
>     "Sitara Bus Services": [7, 12, 14, 18, 20, 22, 1,3, 6],
>     "THIRU TRAVELS & PARCEL SERVICE": [11, 14, 18, 20, 22, 1,3, 6],
>     "VARAHI TOURS AND TRAVELS": [],// Monitoring stopped as per vinay Sir on 04 August 6:10 pm
>     "SHRI VISHWA TRAVELS": [9, 12, 14, 19, 23, 1, 4],
>     "BLUELINE TRANSPORT": [7, 12, 14, 19, 23, 1,4],
>     "G8 indogulf Private Limited": [10, 12, 14, 19, 23, 1,4],
>     "LP Mishra Transport": [9, 12, 15, 19, 0, 2, 4, 6],
>     "Avadhoot Travels": [9, 13, 17, 22, 2, 5],
>     "PAWAR TOURS AND TRAVELS": [9, 13, 17, 22, 2,5],
>     "SUBH YATRI HOLIDAYS": [9, 13, 17, 22, 2,5],
>     "CSR Travels": [9, 13, 17, 22, 2,5],
>     "Saini Travels": [10, 13, 17, 21, 1,4],
>     "Tani Travels": [10, 13, 17, 21, 1,4],
>     "Vishwa Travels": [10, 12, 17, 18, 20, 22, 2,5],
>     "Madurai pandian travels": [9, 14, 18, 21, 2,5],
>     "KMS Travels": [7, 12, 15, 19, 22, 1,4],
>     "Prince Travels": [11, 15, 19, 22, 1,4],
>     "Jaspal Travels": [8, 12, 15, 19, 21, 3,6],
>     "GURU KIRPA TOUR & TRAVELS": [9, 12, 14, 19, 23, 1,4],
>     "VEERA TRAVELS": [10, 12, 14, 19, 23, 1,4],
>     "Shree Ram Travels Guwahati": [9, 12, 14, 19, 23, 1,4],
>     "Namaste Bihar Tours and travels": [11, 12, 14, 18, 22, 2,4, 6],
>     "GAYATRI TRAVELLS": [7, 12, 14, 18, 22, 2,4, 6],
>     "MAHASAGAR TRAVELS LIMITED": [11, 14, 19, 22, 2,4, 6],
>     "SHAMA SARDAR TRAVELS": [11, 14, 19, 22, 2, 4,6],
>     "Mishra Transport Service": [9, 12, 15, 19, 0, 2, 6],
>     "Raja Travels": [9, 13, 17, 21, 3,6],
>     "King Luxuries": [9, 13, 17, 21, 3,6],
>     "Sai Darshan Travels": [8, 14, 18, 21, 2,5],
>     "Solo Express": [8, 14, 16, 18, 20, 22, 3,6],
>     "SNST Bus Line": [8, 14, 16, 18, 20, 22, 3,6],
>     "Humsafar Travels": [8, 13, 17, 21, 1,4],
>     "New India Travels": [9, 13, 17, 21, 1,4],
>     "City Travels": [10, 13, 17, 21, 1,4],
>     "Sri Ganapathy Travels": [10, 13, 17, 22, 2,5],
>     "Zion Connect": [11, 13, 17, 22, 2,5],
>     "Shree Vitthala Travels": [10, 13, 17, 22, 2,5],
>     "SR Tourist": [8, 13, 17, 22, 2,5],
>     "KVS Travels": [10, 13, 17, 18, 20, 22, 2,5],
>     "Nayagan Express": [9, 14, 17, 21, 2,5],
>     "Anirudh Travels": [10, 14, 17, 21, 2,5],
>     "Jagdamb Travels": [10, 14, 18, 21, 2,5],
>     "Arn Travels": [8, 12, 14, 18, 21, 2,5],
>     "PLR Travels": [9, 12, 16, 21, 2,4],
>     "Luxe Express": [11, 13, 16, 21, 2,5],
>     "Sri Amar Shakti Travels & Transport": [8, 12, 17, 19, 21, 2,5],
>     "Dev Travels": [11, 13, 16, 21, 2,5],
>     "GNS Road Links": [11, 15, 19, 21, 2,5],
>     "Bharath Motors": [11, 14, 19, 21, 2,5],
>     "G Tech Sourthenlines": [11, 14, 19, 21, 2,5],
>     "JSB Travels": [8, 12, 15, 19, 21, 2,5],
>     "CityConnect Travels": [9, 13, 15, 19, 21, 2,5],
>     "VSN TRAVELS AND SPEED PARCEL SERVICE": [11, 13, 15, 19, 21, 2,5],
>     "Arthi Travels": [9, 12, 15, 19, 21, 2,5],
>     "JJ YATRA": [10, 15, 19, 21, 2,5],
>     "KBS Sri Garuda": [9, 12, 15, 19, 21, 2,5],
>     "St George Motors": [11, 13, 15, 19, 21, 2,5],
>     "Uma Enterprises": [8, 12, 15, 19, 22, 3,6],
>     "Saaral Travels": [11, 13, 15, 17, 22, 1,4],
>     "CIT Travels": [9, 12, 15, 19, 22, 3,6],
>     "Thirumalaivasan Transports": [10, 12, 15, 19, 22, 3,6],
>     "Swamini Travels": [11, 15, 19, 22, 3,6],
>     "Smart Line Travels": [11, 15, 19, 22, 3,6],
>     "Rao Travel Heights": [11, 15, 19, 22, 3,6],
>     "SVN Tours and Travels": [7, 12, 15, 19, 22, 3,6],
>     "Shatabdi Travels": [8, 12, 15, 19, 22, 3,6],
>     "SASI TRAVELS & TOURS": [9, 12, 15, 19, 22, 3,6],
>     "Sri Kumaran Travels": [11, 15, 19, 22, 3,6],
>     "Radhe Krishna Bus": [10, 12, 15, 19, 22, 1,4],
>     "Esshaa Travels": [8, 13, 15, 19, 22, 1,4],
>     "Sri ponmaghal tours & travels (spt)": [9, 12, 15, 19, 22, 1,4],
>     "Anshi Travels": [11, 15, 19, 22, 1,4],
>     "Om Diya Travels": [8, 12, 15, 19, 22, 1,4],
>     "GMS Bus": [9, 12, 15, 19, 22, 1,4],
>     "JKS BUS SERVICE": [10, 12, 15, 19, 21, 0,3,6],
>     "VVSR TOURS AND TRAVELS": [11, 12, 15, 19, 21, 0,3,6],
>     "Krishna Travels Latur": [7, 12, 15, 19, 21, 0,3,6],
>     "Sanvi Travels": [10, 12, 15, 19, 21, 0,3,6],
>     "A1 Travels": [7, 12, 15, 19, 21, 0,3,6],
>     "Friends motors": [11, 14, 18, 20, 21, 0,3,6],
>     "MAYILON TRANSPORTS": [7, 12, 14, 18, 20, 21, 0,3,6],
>     "GLOBEHOPPER MOBILITY": [10, 12, 14, 18, 21, 0,3,6],
>     "Jay Santaji Travels Shirpur": [11, 12, 14, 18, 21, 0,3,6],
>     "KALLAZHAGAR TRAVELS": [11, 14, 18, 21, 0,3,6],
>     "SUSHEEL TRAVELS": [8, 12, 14, 18, 20, 22, 0,3,6],
>     "MAYIL CONNECT": [8, 12, 14, 18, 20, 22, 1,4, 6],
>     "Lucky Travels": [9, 12, 14, 18, 20, 22, 1, 4, 6],
>     "Bawa lal ji travels": [10, 12, 14, 18, 20, 22, 1,3, 6],
>     "Runwal travels": [7, 12, 14, 18, 20, 22, 1,3, 6],
>     "SIDDHANATH TRAVELS": [8, 12, 14, 18, 20, 22, 1,3, 6],
>     "VPS Transport": [8, 12, 14, 18, 20, 22, 0,3,6],
>     "Subash Travels": [9, 12, 14, 18, 20, 22, 0,3,6],
>     "RUBY TRAVELS": [10, 12, 14, 19, 23, 1,3,6],
>     "Asha Tours and Travels": [11, 14, 19, 23, 1,3,6],
>     "JN HOLIDAYS": [8, 12, 14, 19, 23, 1,3,6],
>     "Vande Bharat Travels": [11, 14, 19, 23, 1,3,5],
>     "SINGHVI TRAVELS": [8, 12, 14, 19, 23, 1,3,5],
>     "Rajdhani Travels": [8, 12, 14, 19, 23, 1,3,5],
>     "SRI RAGHAVENDRA TRAVELS": [8, 12, 14, 18, 22, 1,3,5],
>     "VEEJEY TOURS & TRAVELS": [8, 12, 14, 18, 22, 0,3, 6],
>     "Palak Travels": [10, 12, 14, 18, 22, 0,3, 6],
>     "Mishra Transport Co": [7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,0,1,2,3,4,5,6],
>     "ROJA TRAVELS": [10, 12, 14, 18, 22, 0, 3,6],
>     "New Gold Star Travels": [9, 13, 17, 22, 0,3,5],
>     "RHYTHM TRAVELS AND PARCELS SERVICES": [9, 13, 17, 22, 0,3,5],
>     "SRL TRAVELS": [7, 9, 12, 15, 18, 21, 0,3,5],
>     "SANKARA TRAVELS": [7, 9, 12, 15, 18, 21, 0,3,5],
>     "SEVEN STAR LUXURY TRANZ": [7, 9, 12, 15, 18, 21, 0,3,5],
>     "R S MANI KNIGHT RIDERS": [9, 13, 17, 21, 0,3,5],
>     "Ram Dalal Holidays Pvt Ltd": [9, 13, 17, 19, 21, 0, 1, 2, 3, 4, 5],
>     "Fly Bus India": [9, 13, 17, 21, 0,3,5],
>     "SMST TRAVELS": [7, 9, 11, 13, 17, 21, 0,3,5],
>     "SWAMY AYYAPPA TRAVELS": [9, 11, 13, 17, 21, 0,3,5],
>     "Shree Patel Travels": [8, 13, 14, 16, 18, 21, 2,5],
>     "Jai Vishnu Travels": [11, 13, 17, 21, 1,3,5],
>     "Turbo Bus": [11, 13, 17, 22, 0,3,5],
>     "Shri Subhalaxmi Travels": [11, 13, 17, 22, 0,3,5],
>     "GSM TRANS INDIA": [10, 14, 18, 21, 2,5],
>     "KPS Travels": [8, 12, 15, 19, 21, 2,5],
>     "TPS Travels": [9, 12, 15, 19, 22, 0,3,5],
>     "Nothern Travels": [7, 12, 15, 19, 22, 1,3,5],
>     "Guardian Travels": [9, 12, 15, 19, 21, 0,3,5],
>     "Guardian Tour & Travels": [8, 12, 14, 18, 21, 0,3,5],
>     "KALAIMAKAL ROAD LINES PRIVATE LIMITED": [7, 12, 14, 18, 20, 22, 1,3, 6],
>     "SREE GURUVAYOORAPPA TRAVEL LINES": [8, 12, 14, 18, 20, 22, 1,3, 6],
>     "Jujhar travels": [7, 12, 14, 18, 20, 22, 0,3,5],
>     "Shrinath Travel": [8, 12, 14, 19, 22, 1, 4,6],
>     "New Golden Travels": [10, 12, 14, 19, 23, 1,3,5],
>     "SHREE THENNADU TRAVELS": [9, 12, 14, 19, 23, 1,3,5],
>     "DELTAKING TRAVELS": [10, 14, 18, 22, 0,4, 6],
>     "Silverline Travels": [10, 12, 14, 18, 22, 0,4, 6],
>     "KALAIMAKAL TOURS & TRAVELS": [9, 12, 15, 19, 0, 2, 6],
>     "Kalaimakal Travels": [9, 12, 15, 19, 0, 2, 6],
>     "RUNWAY TRANSPORT": [9, 13, 17, 22, 0,3,5],
>     "GTS Holidays": [9, 13, 17, 22, 0,3,5],
>     "No1 Air Travels 1": [7, 9, 12, 15, 18, 21, 0,3,5],
>     "ARK Travels": [8, 12, 19, 22, 2, 5],
>     "Shree Swami Samarth Travels": [8, 10, 12, 14, 16, 18, 20, 22, 1, 3, 5],
>     "Mohit Travels": [7, 9, 11, 17, 18, 20, 22, 0,2,4, 6],
>     "Red Express": [11, 15, 19, 22, 1, ,3,5],
>     "Aruna bus service": [7, 9, 11, 17, 18, 20, 22, 0, 4,  6],
>     "Sharma Travels Nanded": [7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,0,1,2,3,4,5,6],
>     "Trevel": [7, 9, 11, 13, 15, 17, 19, 21, 23, 1, 3, 5],
> 
> 
>    
> 
> 
>   
>   
> 
> // -------------SCHOOLS---------------
> 
>   "DPS Vikasnagar": [7, 13, 16],
>   "Taxshe": [7, 14, 16],
>   "Gear School": [7, 12, 14, 16],
>   "NGI_ASSAM": [8,15],
>   "NGI_CHHATTISGARH": [8,15],
>   "NGI_GUJARAT": [8,15],
>   "NGI_HARYANA": [8,15],
>   "NGI_MAHARASHTRA": [8,15],
>   "NGI_MP": [8,15],
>   "NGI_ODISHA": [8,15],
>   "NGI_PUNJAB": [8,15],
>   "NGI_RAJASTHAN": [8,15],
>   "NGI_TAMILNADU": [8,15],
>   "NGI_TELANGANA": [8,15],
>   "NGI_UTTAR PRADESH": [8,15],
>   "NGI_KARNATAKA": [8,15],
>   "NGI_West Bengal": [8,15],
>   "Cityflo_Delhi": [9,13,17,20],
>   "Cityflo_Hyderabad": [10,14,17,21],
>   "Cityflo_Mumbai": [8,12,16,20],
>   "Cityflo_Kolkata": [11,15,20],
>   "Infants_Notre Dame": [],// No vehicles in Platform
>   "INF_CHRIST SCHOOL KENGERI": [8, 12, 15, 17],
>   "INF_CHRIST SCHOOL MADIWALA": [8, 12, 15, 17],
>   "INF_CARMEL TERESA SCHOOL": [8, 13, 17],
>   "INF_Holy Family School": [8, 14, 18],
>   "INF_CARMEL Convent": [8, 13, 17],
>   "INF_GIG - BANGLORE": [8, 13, 18], 
>   "INF_GIG - VIJAYAWADA": [8, 13, 18],
>   "INF_NDA": [8, 13, 17],
>   "INF_PRIMUS": [8, 14, 16],
>   "INF_RYAN BGT": [8, 13, 16,],
>   "INF_RYAN KDL": [8, 14, 17,],
>   "INF_RYAN YLK": [8, 14, 17,],
>   "INF_SRI SRI ACADEMY": [8, 15, 17],
>   "INF_SSRVM NORTH": [8, 14, 16],
>   "INF_SSRVM East": [8, 12, 14, 16],
>   "INF_SURANA": [8, 14, 16],
>   "INF_SFS": [8, 14, 16],
>   "INF_NARAYANA ALL": [9, 15, 18],
> 
> 
>   
> // -------------Important---------------
> 
> 
>   
>    
>   "Zingbus": [7, 13, 17, 23, 0, 2, 4, 5, 6],
>   
>   "Kuehne Nagel": [8, 10, 12, 14, 16, 18, 20, 22, 2, 4, 6],
>   
>  
>   "Trev": [9, 13,15,19, 23,1,3,5],
>   
>   
>   
> 
>   
>   "ZAP Cabs": [8,12,16, 20],
>   "Rinku Logistics": [11,15, 20,3],
>   "Adapt Green Fleet": [], // No vehicles in Platform
>   "Steel House": [11, 13, 15],
>   "Relomi": [9, 12, 16, 20, 22, 1],
>   "G4S": [10, 16, 22, 4],
>   "EMobility": [8, 10, 12, 14, 19],
>   "LiON Mobility": [10, 18, 20],
>   "Chahal Transport": [],
> 
> 
>    "INF_AMADEUS": [9, 12, 15, 17],
>    "INF_AUTOLIV IND PVT LTD": [10, 13, 17, 21, 2, 5],
>    "INF_Autoliv Mysore": [],
>    "INF_BIOCON": [], //WhatsApp Group is not created (18- 01- 26) // // No vehicles in Platform
>    "INF_Boeing": [11, 13, 18],
>     
>    "INF_CHENNAI TCS": [11, 15, 18],
>    "INF_DELOITTE": [12, 18], //Beta Group is not created (18- 01- 26)
>    "INF_EISB": [10, 15, 18],
>    "INF_Gamesa Mamandur": [11, 15, 18],
>    "INF_GGI": [12, 15, 18],
>    "INF_GIG": [9, 14, 18, 21, 2, 5],
>    "INF_GLOBAL MINDS": [10, 14, 18],
>    "INF_ICM": [11, 15, 18],
>    "INF_INFOSYS": [12, 15, 18],
>    //"INF_Intel": [],
>    "INF_JEPPIAAR": [10, 14, 18],
>    "INF_JPMC": [11, 15, 18],
>    "INF_L&T CONSTRUCTION EQUIPMENT LTD": [12, 15, 18],
>    "INF_LG": [9, 13, 19],
>    "INF_MYLAN": [9, 13, 19],
>    "INF_ONE CAMPUS": [13, 17, 20, 22, 4, 6, 8],
>    "INF_RNTBCI": [11, 16, 18],
>    "INF_Samsung": [9, 15, 16, 21, 2, 5],
>    "INF_SAP AP": [10, 15, 16],
>    "INF_SAP WF": [11, 14, 16],
>    "INF_SCHNEIDER": [12, 15, 17],
>    "INF_SIEMENS": [10, 14, 16],
>    "INF_Xiomi": [10, 14, 16],
>    "INF_Strides": [9, 14, 16, 21, 2, 5],
>    "INF_BIOCON SYNGENE": [11, 14, 16],
>    "INF_TASL E-CITY": [12, 15, 16],
>    "INF_TASL JIGANI": [10, 14, 16],
>    "INF_TASL-VEMAGAL": [11, 14, 16],
>    "INF_TECH MAHINDRA": [10, 15, 17],
>    "INF_TENNECO": [9, 15, 17],
>    "INF_TEPL MG": [10, 14, 16, 19, 4, 5],
>    "INF_TEPL HOSUR": [],
>    "INF_TEPL JASMINE": [9, 15, 17, 19, 23, 3, 5],
>    "INF_TESS": [9, 17, 21, 2, 5],
>    "INF_TSAT": [9, 13, 15, 17],
>    "INF_TVS": [10, 13, 16,],
>    "INF_VISHWA VIDYAPEETH": [11, 13, 16,],
>    "INF_VOLVO": [9, 13, 16, 21, 2, 5],
> 
>   
> 
> 
>   
> };
> 
> 
> 
> 
> 
> 
> const EMPLOYEE_CUSTOM_TEXT = { 
>   
>   "Shashi":    { 12:"Infants OFFLINE Calling ",13:"Infants OFFLINE Calling ", 14:"CALL", 15:"CALL", 16:"CALL", },
>   "Afzal":    { 12:"CALL", 13:"CALL", 14:"CALL", 15:"CALL", 16:"CALL",},
>   "BRINDA": { 15:"CALL"},
>   "Naveen": { 14:"CALL"},
>   "Ritanjali": { 12:"CALL"},
>   "CHANDAN" : { 22:"Night Fleet Update"},
>   "HARI": { 22:"OFFLINE REPORTS" ,23:"OFFLINE REPORTS" },
>   "MANTU" : {  4:"Night Fleet Update"},
> 
> };
> 
> 
> 
> 
> 
> 
> const EMPLOYEE_SPECIFIC_CLIENTS = {
>   "GUNASAGARI": {
>     8:["Cityflo_Mumbai",],
>     9: ["CF-Chennai","Cityflo_Delhi",],
>     10: ["Cityflo_Hyderabad",],
>     11: ["Cityflo_Kolkata"],
>     12:["Cityflo_Mumbai",],
>     13:["Cityflo_Delhi",],
>     14:["Cityflo_Hyderabad",],
>     15: ["Cityflo_Kolkata"],
>     16:["Cityflo_Mumbai",],
>     17:["Cityflo_Delhi","Cityflo_Hyderabad"],
>    },
> 
> 
>   "HARI": {
>     0:  ["Zingbus",],
>     2:  ["Zingbus",],
>     4:  ["Zingbus",],
>   },
> 
> 
>   "Kiran": {
>     23: ["Zingbus",],
>     5:  ["Zingbus",],
>   },
> 
> 
> 
> };
> 
> 
> 
> koi single cheez bhi miss nhii hona chahiye wrna bht gadbad ho jaaygi... sb hona chahiye okay, and ek baar or test kr k dekho and single bug nhii hona chahiye

### 29. 05:14 PM

> Ye jo chaaro cards hn performance score wghaira, ye kis basis pr ate hn kya data k according calculate hota h...
> and ye Gunasagari ko 16 bje sirf perticular client hi milega 'Employee_Hours' is sheet me hena, but usko doosre clients bhi mil rhe hn, 
> and ye admin wale me dekho, and sheet dekho, gunasagari ne INF_TEPL MG is client ka misalign vehicle bhi fill kra h and alert bhi dala h fatigue bhi to ek alert hi hena, but admin me koi entry nhi bta rhi...and ye dekho, break start kb hua 04:49:58 pm and mere screen shot me real time kya ho rha h 16:53, abhi tk 1 min hi bta rha h and doosre employee ka 0. kya kr diya yr,,, auto refresh nhii hota kya???or bhi cheeze dekho yr and fix kro please... ese kese work kr paaygi team jb itne bugs ho itne zyada issues ho platform me.. and bht slow bhi chal rha h platform, fast chalna chahiyena... best and perfect chahiye yr please... and ek baat or bolna chahta hu. employee and admin ka jo layout ya yu kahu UI UX hena bht confusion h clean nhi h... ek kaam kro scratch se redesign kr do and facebook youtube, instagram in badi badi companies k jese crm hote h ya platform hote h wesa design krdo. and theme k colour change nhi krna, colours jo h wo wese hi rehna chahiye, iske alawa sara designr layout product full best krdo, and ye bhi new tareeke se krdo k employee clients kaha pr update krenge kesa layout rhega sara subkuch scratch se redesign krdo and best krdo. koi bug nhi rehna chahiye, saare test krna okay. live test krna...

### 30. 05:31 PM

> mjhe teeno ka ek baar sample layout bnaakr dedo taake decide krne me asaani rhe, mjhe design ki images bnaakr de dena taake or bhi sahi se decide kr saku... and yr abhi jo last update kra uska pull request nhi dikh rhi mjhe github pr

### 31. 11:34 PM

> Mjhe to Split view best lg rha h... is pr baadme baat krenge sbse pehle mjhe updated Handbook to dedo yr


