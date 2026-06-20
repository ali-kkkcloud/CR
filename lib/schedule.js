// lib/schedule.js
// Core principle: distribution is based on SCHEDULED employees, not login status.
// Only admin "leave" action removes someone from distribution.

export const CLIENT_TIMINGS = {
  "Milo Drive": [7, 13, 21, 23, 1, 4],
  "Eden Green Energy": [9, 12, 17, 19, 22,], 
  "Vijaylaxmi Travels": [8, 14, 21, 23, 1, 4],
  "Aastha tourist and logistics": [9, 15, 21, 23, 1, 4],
  "Shoffr_Delhi": [10, 16, 21, 23, 1, 4],
  "Shoffr_Hyderabad": [10, 16, 21, 23, 1, 4],
  "Shoffr_Bangalore": [5, 12, 1],
  "Versatile Pvt Ltd": [11, 17, 21, 23, 1, 4],
  "Power Move": [7, 18, 22, 0, 2, 4],
  "Routematic- Goa": [8, 19, 22, 0, 2, 4],
  "Routematic- Mumbai": [9, 20, 22, 0, 2, 4],
  "Ashok Bus Service": [10, 13, 22, 0, 2, 4],
  "Shree Sairam Travels": [11, 14, 22, 0, 2, 4],
  "Shree Patel Travels": [7, 15, 21, 23, 2, 5],
  "Sai Darshan Travels": [8, 16, 21, 23, 2, 5],
  "Ashray Travels": [9, 17, 21, 23, 2, 5],
  "Shreyas Travels Aurangabad": [10, 18, 21, 23, 2, 5],
  "Deepak Raj Bus service": [11, 19, 21, 23, 2, 5],
  "Navneet Travels": [7, 20, 21, 23, 2, 5],
  "Ashok Travels": [8, 13, 21, 23, 2, 5],
  "Shree Saroj Travels": [9, 14, 21, 23, 2, 5],
  "Choudhary Tours and Travels": [10, 15, 21, 23, 2, 5],
  "Sanjay Travels Nagpur": [11, 16, 22, 0, 3, 5],
  "Solo Express": [7, 17, 22, 0, 3, 5],
  "Bac Cabs": [8, 18, 22, 0, 3, 5],
  "SNST Bus Line": [9, 19, 22, 0, 3, 5],
  "DNR Express": [10, 20, 22, 0, 3, 5],
  "Sri Maruthi Travels": [11, 13, 22, 1, 3, 5],
  "Sindh Radhe Travels": [7, 14, 22, 1, 3, 5],
  "Ram Tours and Travels": [8, 15, 22, 1, 3, 5],
  "Citizen Travels Indore": [9, 16, 22, 1, 3, 5],
  "Citizen Travels Bombay": [10, 17, 21, 0, 3, 6],
  "Shree Ganesh Travels": [11, 18, 21, 0, 3, 6],
  "ABR Roadlines": [7, 19, 21, 0, 3, 6],
  "Jogeshwari Enterprises": [8, 20, 21, 0, 3, 6],
  "Indumati Travels": [9, 13, 22, 1, 4, 6],
  //"Maharaja Paulo Surat": [],
  "Pooja Travels Nagpur": [11, 15, 22, 1, 4, 6],
  "Leafy Bus": [10, 16, 21, 23, 1,3, 5], 
  "SaarthiEV": [8, 17, 22, 1, 4, 6],
  "OKO Elite": [9, 18, 23, 1, 3, 6],
  "Boom Cabs": [14, 1, 4],
  "Euro Cars- Chennai": [11, 20, 23, 1, 3, 6],
  "Euro Cars- Kolkata": [7, 13, 23, 1, 3, 6],
  "Euro Cars- Mumbai": [8, 14, 23, 1, 3, 6],
  "Euro Cars- Delhi": [9, 15, 0, 2, 4, 6],
  "Euro Cars- Bangalore": [10, 16, 0, 2, 4, 6],
  "Euro Cars- Hyderabad": [11, 17, 0, 2, 4, 6],
  "Green Drive Mobility": [],
  "Saini Travels": [8, 19, 21, 23, 1, 4],
  "Humsafar Travels": [9, 20, 21, 23, 1, 4],
  "Prasanna Purple Mobility Solutions": [10, 13, 21, 23, 1, 4],
  "Kundan Travels": [11, 14, 21, 23, 1, 4],
  "Nura Electric Mobility": [10, 15, 21, 23, 1, 4],
  "Eco Mobility": [8, 16, 21, 23, 1, 4],
  "New India Travels": [9, 17, 21, 23, 1, 4],
  "Tani Travels": [10, 18, 21, 23, 1, 4],
  "SAP infralogistics": [11, 19, 21, 23, 1, 4],
  //"Sun Transmovers": [],
  "Switch Labs": [8, 13, 21, 23, 1, 4],
  // "Sterlite Copper": [], No WhatsApp group
  "BABA travels": [10, 15, 21, 23, 1, 4],
  "City Travels": [11, 16, 21, 23, 1, 4],
  //"Goga Sikotar Travels Dwarka": [],
  "Royal Travels Nagpur": [8, 18, 21, 23, 1, 4],
  "Royal Travels Amravati": [9, 19, 21, 23, 1, 4],
  "Gola Bus Service": [10, 20, 21, 23, 1, 4],
  "A TO Z Cab Services": [11, 13, 21, 23, 1, 4],
  "Ansari Travels": [7, 14, 21, 23, 1, 4],
  "Chulbul Bus Service": [8, 15, 21, 23, 1, 4],
  "Manish Travels Durg": [9, 16, 21, 23, 1, 4],
  "PSS Transport": [10, 17, 22, 0, 2, 4],
  "Jai Vishnu Travels": [11, 18, 22, 0, 2, 4],
  "Matoshree Tours and Travels": [7, 19, 22, 0, 2, 4],
  "Zelssy": [8, 20, 22, 0, 2, 4],
  "SAAM Tours and Travels": [9, 13, 22, 0, 2, 4],
  "Dada Brothers Raipur": [10, 14, 22, 0, 2, 4],
  "Turbo Bus": [11, 15, 22, 0, 2, 4],
  "RR TRAVELS": [7, 16, 22, 0, 2, 4],
  "V2K Travels": [8, 17, 22, 0, 2, 4],
  "GRT": [9, 18, 22, 0, 2, 4],
  "Sri Ganapathy Travels": [10, 19, 22, 0, 2, 4],
  "Zion Connect": [11, 20, 22, 0, 2, 4],
  "SHRI CHAMUNDA TRAVELS ": [7, 13, 22, 0, 2, 4],
  "Naveen Travels": [8, 14, 22, 0, 2, 4],
  "National travels": [9, 15, 22, 0, 2, 4],
  "Krishna Travels Udgir": [10, 16, 22, 0, 2, 4],
  "Shri Subhalaxmi Travels": [11, 17, 22, 0, 2, 4],
  "Shree Vitthala Travels": [7, 18, 22, 0, 2, 4],
  "Balaji Cabs": [8, 19, 22, 0, 2, 4],
  "JAY SAI TOURS AND TRAVELS": [9, 20, 22, 0, 2, 4],
  "MANOJ TOURS AND TRAVELS": [10, 13, 22, 0, 2, 4],
  "SHIV SAI TRAVEL AGENCY": [11, 14, 22, 0, 2, 4],
  "Soni Travels": [ 15, 0, 3],
  "SR Tourist": [8, 16, 21, 23, 2, 5],
  "Turbotork Technologies": [9, 17, 21, 23, 2, 5],
  "KVS Travels": [10, 18, 21, 23, 2, 5],
  "Apple Bus": [11, 19, 21, 23, 2, 5],
  "Vishwa Travels": [7, 20, 21, 23, 2, 5],
  "Igus": [8, 13, 21, 23, 2, 5],
  "Nayagan Express": [9, 14, 21, 23, 2, 5],
  "Anirudh Travels": [10, 15, 21, 23, 2, 5],
  "Uncle Travels": [11, 16, 21, 23, 2, 5],
  "GSM TRANS INDIA": [7, 17, 21, 23, 2, 5],
  "Alif Travels": [8, 18, 21, 23, 2, 5],
  "Madurai pandian travels": [9, 19, 21, 23, 2, 5],
  "Jagdamb Travels": [10, 20, 21, 23, 2, 5],
  "Anand Tours and travels Pune": [11, 13, 21, 23, 2, 5],
  "Agni travels": [7, 14, 21, 23, 2, 5],
  "Arn Travels": [8, 15, 21, 23, 2, 5],
  "PLR Travels": [9, 16, 21, 23, 2, 5],
  "Mettur super service": [10, 17, 21, 23, 2, 5],
  "Vinoth Travels": [11, 18, 21, 23, 2, 5],
  "Luxe Express": [7, 19, 21, 23, 2, 5],
  "Sri Amar Shakti Travels & Transport": [8, 20, 21, 23, 2, 5],
  "Ashweeta Travels": [9, 13, 21, 23, 2, 5],
  "SJV Travels": [10, 14, 21, 23, 2, 5],
  "Dev Travels": [11, 15, 21, 23, 2, 5],
  "Nandi Mobility": [7, 16, 21, 23, 2, 5],
  "Sree Varun Travels": [8, 17, 21, 23, 2, 5],
  "Sri Vaari Travels": [9, 18, 21, 23, 2, 5],
  "Athena": [10, 19, 21, 23, 2, 5],
  "Drivonaut": [7, 13, 21, 23, 2, 5],
  "TRANSBOOK INDIA LLP": [8, 14, 21, 23, 2, 5],
  "Golden Temple Express": [9, 15, 21, 23, 2, 5],
  "Venture Transport Services": [10, 16, 21, 23, 2, 5],
  "GNS Road Links": [11, 17, 21, 23, 2, 5],
  "Bharath Motors": [7, 18, 21, 23, 2, 5],
  "KRS Travels": [8, 19, 21, 23, 2, 5],
  "Aakash Travels": [9, 20, 21, 23, 2, 5],
  "SGT translink": [10, 13, 21, 23, 2, 5],
  "G Tech Sourthenlines": [11, 14, 21, 23, 2, 5],
  "New Pramukhraj Travels": [7, 15, 21, 23, 2, 5],
  "JSB Travels": [8, 16, 21, 23, 2, 5],
  "CityConnect Travels": [9, 17, 21, 23, 2, 5],
  "Biyani Travels": [10, 18, 21, 23, 2, 5],
  "Bharmani Travels": [11, 19, 21, 23, 2, 5],
  "VSN TRAVELS AND SPEED PARCEL SERVICE": [7, 20, 21, 23, 2, 5],
  "Golden Power Travels": [8, 13, 21, 23, 2, 5],
  "Arthi Travels": [9, 14, 21, 23, 2, 5],
  "JJ YATRA": [10, 15, 22, 0, 3, 5],
  "VKV Travels": [11, 16, 22, 0, 3, 5],
  "Lion travels": [7, 17, 22, 0, 3, 5],
  "KPS Travels": [8, 18, 22, 0, 3, 5],
  "KBS Sri Garuda": [9, 19, 22, 0, 3, 5],
  "Mr.Holidays": [10, 20, 22, 0, 3, 5],
  "St George Motors": [11, 13, 22, 0, 3, 5],
  //"Bhawani Travels": [], Need to removed the device
  "Uma Enterprises": [8, 15, 22, 0, 3, 5],
  "HDC Transworld": [16,],
  "Yuga Travels": [10, 17, 22, 0, 3, 5],
  "Jai Mata Di Travels": [11, 18, 22, 0, 3, 5],
  "Saaral Travels": [7, 19, 22, 0, 3, 5],
  "HARSH TRAVELS": [8, 20, 22, 0, 3, 5],
  "CIT Travels": [9, 13, 22, 0, 3, 5],
  "Thirumalaivasan Transports": [10, 14, 22, 0, 3, 5],
  "Swamini Travels": [11, 15, 22, 0, 3, 5],
  "VHB Travels": [7, 16, 22, 0, 3, 5],
  "Cumbum Travels": [8, 17, 22, 0, 3, 5],
  "TPS Travels": [9, 18, 22, 0, 3, 5],
  "Starline": [10, 19, 22, 0, 3, 5],
  "Smart Line Travels": [11, 20, 22, 0, 3, 5],
  "Rao Travel Heights": [7, 13, 22, 0, 3, 5],
  "Instant Panthers": [8, 14, 22, 0, 3, 5],
  "Jaya Rajeshwari Travels": [9, 15, 22, 1, 3, 5],
  "PSR TRAVELS": [10, 16, 22, 1, 3, 5],
  "Xelite Travels": [11, 17, 22, 1, 3, 5],
  "SVN Tours and Travels": [7, 18, 22, 1, 3, 5],
  "Shatabdi Travels": [8, 19, 22, 1, 3, 5],
  "SASI TRAVELS & TOURS": [9, 20, 22, 1, 3, 5],
  "Shri Abhinesh Roadways": [10, 13, 22, 1, 3, 5],
  "Sri Kumaran Travels": [11, 14, 22, 1, 3, 5],
  "ATMARAM TRAVELS": [7, 15, 22, 1, 3, 5],
  "KRISHNA ENTERPRISES": [8, 16, 22, 1, 3, 5],
  "JRDELTA TOUR SERVICE PRIVATE LIMITED": [9, 17, 22, 1, 3, 5],
  "Sri Ram Cargo": [10, 18, 22, 1, 3, 5],
  "DFC Logistics": [11, 19, 22, 1, 3, 5],
  "KMS Travels": [7, 20, 22, 1, 3, 5],
  "Ashwini Tours Travels": [8, 13, 22, 1, 3, 5],
  "SST Limoliner": [9, 14, 22, 1, 3, 5],
  "Radhe Krishna Bus": [10, 15, 22, 1, 3, 5],
  "Prince Travels": [11, 16, 22, 1, 3, 5],
  //"Mehrotra Tours & Travels": [],
  "Esshaa Travels": [8, 18, 22, 1, 3, 5],
  "Sri ponmaghal tours & travels (spt)": [9, 19, 22, 1, 3, 5],
  "Sethi yatra company": [10, 20, 22, 1, 3, 5],
  "Anshi Travels": [11, 13, 22, 1, 3, 5],
  "Nothern Travels": [7, 14, 21, 0, 3, 6],
  "Om Diya Travels": [8, 15, 21, 0, 3, 6],
  "GMS Bus": [9, 16, 21, 0, 3, 6],
  "Kohinoor Tours and Travels": [10, 17, 21, 0, 3, 6],
  "APSARA TRAVELS": [11, 18, 21, 0, 3, 6],
  "Anand Bus Transport": [8,12,14,16,18, 20, 21, 0, 3, 6],
  "Rajkalpana Travels": [9, 13, 21, 0, 3, 6],
  "MEDIKONDA TRRAVELS": [10, 14, 21, 0, 3, 6],
  "Red Express": [11, 15, 21, 0, 3, 6],
  "KARTHIKEYA TOURS AND TRAVELS": [7, 16, 21, 0, 3, 6],
  "AVLT TRANS": [8, 17, 21, 0, 3, 6],
  "Guardian Travels": [9, 18, 21, 0, 3, 6],
  "JKS BUS SERVICE": [10, 19, 21, 0, 3, 6],
  "VVSR TOURS AND TRAVELS": [11, 20, 21, 0, 3, 6],
  "Krishna Travels Latur": [7, 13, 21, 0, 3, 6],
  "BARDE ROADLINES": [8, 14, 21, 0, 3, 6],
  "Sanvi Travels": [9, 15, 21, 0, 3, 6],
  "Iconic Travels and Holidays": [10, 16, 21, 0, 3, 6],
  "A1 Travels": [11, 17, 21, 0, 3, 6],
  "Nakoda Travels Kolhapur": [7, 18, 21, 0, 3, 6],
  "Nakoda Travels Sangli": [8, 19, 21, 0, 3, 6],
  "SRI SIDDHAN TRAVELS": [9, 20, 22, 1, 4, 6],
  "Friends motors": [10, 13, 22, 1, 4, 6],
  "MAYILON TRANSPORTS": [11, 14, 22, 1, 4, 6],
  "Jaspal Travels": [7, 15, 22, 1, 4, 6],
  "Indo Canadian Transport Co Private Limited": [8, 16, 22, 1, 4, 6],
  "GLOBEHOPPER MOBILITY": [9, 17, 22, 1, 4, 6],
  "Jay Santaji Travels Shirpur": [10, 18, 22, 1, 4, 6],
  "AKANKSHA TOURISM": [11, 19, 22, 1, 4, 6],
  "Guardian Tour & Travels": [7, 20, 22, 1, 4, 6],
  "Mr.Holidays": [8, 13, 22, 1, 4, 6],
  "Surakshith Fleet": [9, 14, 22, 1, 4, 6],
  "KALLAZHAGAR TRAVELS": [10, 15, 22, 1, 4, 6],
  "Expo Logistics": [11, 16, 22, 1, 4, 6],
  "SUSHEEL TRAVELS": [7, 17, 22, 1, 4, 6],
  "BAIKUNTHA TRANSPORT SERVICE": [8, 18, 22, 1, 4, 6],
  "VINAYAGA SELVAM TRAVELS": [9, 19, 22, 1, 4, 6],
  "Manish Travels Bhuwasal": [10, 20, 22, 1, 4, 6],
  "KALAIMAKAL ROAD LINES PRIVATE LIMITED": [11, 13, 22, 1, 4, 6],
  "SREE GURUVAYOORAPPA TRAVEL LINES": [7, 14, 22, 1, 4, 6],
  "JB Connect": [8, 15, 22, 1, 4, 6],
  "Golden Temple Volvo Bus Services": [9, 16, 22, 1, 4, 6],
  "Sitara Bus Services": [10, 17, 22, 1, 4, 6],
  "MAYIL CONNECT": [11, 18, 22, 1, 4, 6],
  "Lucky Travels": [7, 19, 23, 1, 3, 6],
  "Bawa lal ji travels": [8, 20, 23, 1, 3, 6],
  "SAI ABHISHEK TRAVELS": [9, 13, 23, 1, 3, 6],
  "Runwal travels": [10, 14, 23, 1, 3, 6],
  "SIDDHANATH TRAVELS": [11, 15, 23, 1, 3, 6],
  "Harwinder Enterprises": [7, 16, 23, 1, 3, 6],
  "RS Yadav Smart Bus": [8, 17, 23, 1, 3, 6],
  "THIRU TRAVELS & PARCEL SERVICE": [9, 18, 23, 1, 3, 6],
  "Jujhar travels": [10, 19, 23, 1, 3, 6],
  "VPS Transport": [11, 20, 23, 1, 3, 6],
  "Subash Travels": [7, 13, 23, 1, 3, 6],
  "VARAHI TOURS AND TRAVELS": [8, 14, 23, 1, 3, 6],
  "Ramesh Tours and Travels": [9, 15, 23, 1, 3, 6],
  "FLY BUS": [10, 16, 23, 1, 3, 6],
  "Shrinath Travel": [11, 17, 23, 1, 3, 6],
  "SHRI VISHWA TRAVELS": [7, 18, 23, 1, 3, 6],
  "RUBY TRAVELS": [8, 19, 23, 1, 3, 6],
  "Asha Tours and Travels": [9, 20, 23, 1, 3, 6],
  "BLUELINE TRANSPORT": [10, 13, 23, 1, 3, 6],
  "JN HOLIDAYS": [11, 14, 23, 1, 3, 6],
  "Tegra Express": [7, 15, 23, 1, 3, 6],
  "New Golden Travels": [8, 16, 23, 1, 3, 6],
  "Vande Bharat Travels": [9, 17, 23, 1, 3, 6],
  "Vasudeo Travels": [10, 18, 23, 1, 3, 6],
  "SINGHVI TRAVELS": [11, 19, 0, 2, 4, 6],
  "GURU KIRPA TOUR & TRAVELS": [7, 20, 0, 2, 4, 6],
  "VEERA TRAVELS": [8, 13, 0, 2, 4, 6],
  "Radha Vallabh Travels Rewa": [9, 14, 0, 2, 4, 6],
  "NANDAN TRAVELS SEONI": [10, 15, 0, 2, 4, 6],
  "MUSAFIR TRAVELS": [11, 16, 0, 2, 4, 6],
  "SHREE THENNADU TRAVELS": [7, 17, 0, 2, 4, 6],
  "MGK Logistics": [8, 18, 0, 2, 4, 6],
  "Yashshree Travels": [9, 19, 0, 2, 4, 6],
  "SHRI SWAMINARAYAN TRAVELS": [10, 20, 0, 2, 4, 6],
  "Rajdhani Travels": [11, 13, 0, 2, 4, 6],
  "Shree Ram Travels Guwahati": [7, 14, 0, 2, 4, 6],
  "G8 indogulf Private Limited": [8, 15, 0, 2, 4, 6],
  "DFC Logistics_Uber": [9, 16, 0, 2, 4, 6],
  "Zubins Royal Fleet": [10, 17, 0, 2, 4, 6],
  "SRI RAGHAVENDRA TRAVELS": [11, 18, 0, 2, 4, 6],
  "SRI AMBADEVI TRAVELLS": [7, 19, 0, 2, 4, 6],
  "DELTAKING TRAVELS": [8, 20, 0, 2, 4, 6],
  "Namaste Bihar Tours and travels": [9, 13, 0, 2, 4, 6],
  "GAYATRI TRAVELLS": [10, 14, 0, 2, 4, 6],
  "VEEJEY TOURS & TRAVELS": [11, 15, 0, 2, 4, 6],
  "Sri Srinivasa Bus": [7, 16, 0, 2, 4, 6],
  "Palak Travels": [8, 17, 0, 2, 4, 6],
  "Mishra Transport Co": [9, 18, 0, 2, 4, 6],
  "MAHASAGAR TRAVELS LIMITED": [10, 19, 22, 1, 3, 5],
  "RELIANCE TRAVELS MAYILADUTHURAI": [11, 20, 22, 1, 3, 5],
  "SHAMA SARDAR TRAVELS": [7, 13, 22, 1, 3, 5],
  "ExServiceman Logistics": [8, 14, 0, 2, 4, 6],
  "Silverline Travels": [9, 15, 0, 2, 4, 6],
  "SIDDHI VINAYAKA TRAVELS": [10, 16, 0, 2, 4, 6],
  "ROJA TRAVELS": [11, 17, 0, 2, 4, 6],
  "NKB SMART BUS PRIVATE LIMITED": [7, 18, 0, 2, 4, 6],
  "BLUEWORLD TOURIST Pvt Ltd": [8, 19, 0, 2, 4, 6],
  "Abhishek Travels": [9, 20, 0, 2, 4, 6],
  "MB Link": [10, 13, 0, 2, 4, 6],
  "Mishra Transport Service": [11, 14, 22, 1, 3, 5],
  "LP Mishra Transport": [7, 15, 22, 1, 3, 5],
  "KALAIMAKAL TOURS & TRAVELS": [8, 16, 22, 1, 3, 5],
  "Kalaimakal Travels": [9, 17, 22, 1, 3, 5],
  "RUNWAY TRANSPORT": [10, 18, 22, 1, 3, 5],
  "MG Transport": [10, 18, 22, 1, 3, 5],
  "EXCEL TOURS TRAVELS": [10, 18, 22, 1, 3, 5],
  "Avadhoot Travels": [10, 18, 22, 1, 3, 5],
  "PAWAR TOURS AND TRAVELS": [10, 18, 22, 1, 3, 5],
  "SAFAR EXPRESS TOUR & TRAVELS": [10, 18, 22, 1, 3, 5],
  "SUBH YATRI HOLIDAYS": [10, 18, 22, 1, 3, 5],
  "KPM Tours and Travels": [8, 10, 12, 14, 16, 18, 22, 1, 3, 5],
  "JIHAN LUXURY TRAVELS": [10, 18, 22, 1, 3, 5],
  "CSR Travels": [10, 18, 22, 1, 3, 5],
  "Sarathi X": [10, 18, 22, 1, 3, 5],
  "ROYCE LOGISTICS PRIVATE LIMITED": [9, 13, 17, 22, 0, 2, 4],
  "New Gold Star Travels": [9, 13, 17, 22, 0, 2, 4],
  "G.T.S Holidays": [9, 13, 17, 22, 0, 2, 4],
  "RHYTHM TRAVELS AND PARCELS SERVICES": [9, 13, 17, 22, 0, 2, 4],
  "Fery Rides": [7, 9, 12, 15, 18, 21, 0, 3, 6],
  "No1 Air Travels 1": [7, 9, 12, 15, 18, 21, 0, 3, 6],
  "SRL TRAVELS": [7, 9, 12, 15, 18, 21, 0, 3, 6],
  "SANKARA TRAVELS": [7, 9, 12, 15, 18, 21, 0, 3, 6],
  "Cityflo_Delhi": [12],
  "Cityflo_Hyderabad": [12],
  "Cityflo_Mumbai": [12],
  "Cityflo_Kolkata": [12],
}

export const EMPLOYEE_SPECIFIC_CLIENTS = {
  "BRINDA": {
    8: ["CF-Mumbai"], 9: ["CF-Chennai","CF-Delhi"],
    10: ["CF-Hyderabad"], 11: ["CF-Kolkata"],
  },
  "Hariprasad": {
    22: ["Kuehne Nagel","Zingbus"],
    23: ["Prasanna Purple Mobility Solutions","ABR Roadlines","Leafy Bus","Shree Sairam Travels"],
    0:  ["Kuehne Nagel","Zingbus","Mohit Travels"],
    1:  ["Prasanna Purple Mobility Solutions","ABR Roadlines","Leafy Bus","Shree Sairam Travels","Mohit Travels"],
    2:  ["Kuehne Nagel","Zingbus","INF_ONE CAMPUS","Mohit Travels"],
    3:  ["Prasanna Purple Mobility Solutions","ABR Roadlines","Leafy Bus","Shree Sairam Travels","Mohit Travels"],
    4:  ["Kuehne Nagel","Zingbus","Mohit Travels"],
    5:  ["Prasanna Purple Mobility Solutions","ABR Roadlines","Leafy Bus","INF_ONE CAMPUS","Zingbus","Mohit Travels"],
  },
}

export const EMPLOYEE_CUSTOM_TEXT = {
  "BRINDA": { 12:"CALL", 13:"CALL", 14:"CALL", 15:"CALL", 16:"CALL", 17:"CALL", 18:"CALL" },
  "Shashi": { 14:"Infants OFFLINE Calling" },
  "HARI":   { 20:"OFFLINE REPORTS" },
}

export const ALL_EMPLOYEES = [
  { name:"GUNASAGARI", start:8,  end:17, isNight:false },
  { name:"KIRAN",      start:12, end:21, isNight:false },
  { name:"Ritanjali",  start:8,  end:10, isNight:false },
  { name:"BRINDA",     start:8,  end:17, isNight:false },
  { name:"Nesiya",     start:8,  end:17, isNight:false },
  { name:"Rakesh",     start:18, end:21, isNight:false },
  { name:"HARI",       start:12, end:21, isNight:false },
  { name:"Sunil",      start:12, end:21, isNight:false },
  { name:"RISHI",      start:7,  end:16, isNight:false },
  { name:"Naveen",     start:12, end:21, isNight:false },
  { name:"Hariprasad", start:22, end:7,  isNight:true  },
  { name:"Shashi",     start:21, end:6,  isNight:true  },
  { name:"Mahesh",     start:21, end:6,  isNight:true  },
  { name:"MANTU",      start:22, end:7,  isNight:true  },
  { name:"CHANDAN",    start:22, end:7,  isNight:true  },
]

export function isScheduledAtHour(emp, hour) {
  if (emp.isNight) return hour >= emp.start || hour < emp.end
  return hour >= emp.start && hour < emp.end
}

// Get all employees SCHEDULED for this hour (regardless of login status)
// Subtract anyone admin has marked on leave for this hour
export function getScheduledEmployeesAtHour(hour, leaveMap = {}) {
  return ALL_EMPLOYEES.filter(emp => {
    if (!isScheduledAtHour(emp, hour)) return false
    const leaves = leaveMap[emp.name] || []
    // leaveMap[empName] = array of { fromHour, toHour } — exclude if this hour is covered
    for (const leave of leaves) {
      if (isHourInLeave(hour, leave.fromHour, leave.toHour)) return false
    }
    return true
  })
}

function isHourInLeave(hour, fromHour, toHour) {
  // fromHour inclusive, toHour exclusive (same-day range)
  if (fromHour <= toHour) return hour >= fromHour && hour < toHour
  // Crosses midnight
  return hour >= fromHour || hour < toHour
}

function getVehicleCountLocal(vehicleMap, clientName) {
  const key = (clientName || '').toString().trim().toLowerCase()
  return vehicleMap[key]?.vehicleCount || 0
}

// Core distribution — scheduled employees (admin-leave-aware), locked-assignment-aware
export function distributeClientsForHour(hour, scheduledEmployeeNames, vehicleMap = {}, lockedAssignments = {}) {
  const distribution = {}
  scheduledEmployeeNames.forEach(name => { distribution[name] = [] })
  if (scheduledEmployeeNames.length === 0) return distribution

  const sorted = [...scheduledEmployeeNames].sort((a, b) => a.localeCompare(b))
  const reservedClients = new Set()
  const customTextEmps  = new Set()

  sorted.forEach(name => {
    if (EMPLOYEE_CUSTOM_TEXT[name]?.[hour]) { customTextEmps.add(name); return }
    const specific = EMPLOYEE_SPECIFIC_CLIENTS[name]?.[hour]
    if (specific) {
      distribution[name].push(...specific.map(c => ({
        client: c, vehicleCount: getVehicleCountLocal(vehicleMap, c), isSpecific: true,
      })))
      specific.forEach(c => reservedClients.add(c))
    }
  })

  // Apply locked assignments (already decided this hour — don't reshuffle)
  Object.entries(lockedAssignments).forEach(([clientName, empName]) => {
    if (reservedClients.has(clientName)) return
    if (!distribution[empName]) return
    distribution[empName].push({
      client: clientName, vehicleCount: getVehicleCountLocal(vehicleMap, clientName),
      isSpecific: false, isLocked: true,
    })
    reservedClients.add(clientName)
  })

  const remainingClients = Object.entries(CLIENT_TIMINGS)
    .filter(([, hours]) => hours.includes(hour))
    .map(([name]) => name)
    .filter(c => !reservedClients.has(c))
    .sort((a, b) => getVehicleCountLocal(vehicleMap, b) - getVehicleCountLocal(vehicleMap, a))

  const eligibleEmps = sorted.filter(name => !customTextEmps.has(name))

  if (eligibleEmps.length > 0) {
    const load = {}
    eligibleEmps.forEach(name => {
      load[name] = distribution[name].reduce((s, c) => s + c.vehicleCount, 0)
    })
    remainingClients.forEach(client => {
      const vehicleCount = getVehicleCountLocal(vehicleMap, client)
      let minEmp = eligibleEmps[0]
      eligibleEmps.forEach(name => { if (load[name] < load[minEmp]) minEmp = name })
      distribution[minEmp].push({ client, vehicleCount, isSpecific: false })
      load[minEmp] += vehicleCount
    })
  }

  return distribution
}

export function getClientsForEmployeeAtHour(employeeName, hour, scheduledEmployeeNames, vehicleMap = {}, lockedAssignments = {}) {
  const customText = EMPLOYEE_CUSTOM_TEXT[employeeName]?.[hour]
  if (customText) return [{ client: customText, isCustom: true }]

  const dist = distributeClientsForHour(hour, scheduledEmployeeNames, vehicleMap, lockedAssignments)
  return (dist[employeeName] || []).map(c => ({
    client: c.client, vehicleCount: c.vehicleCount, isSpecific: c.isSpecific,
  }))
}

// For End Shift — only current hour's UNFILLED clients move to others
export function computeCurrentHourRedistribution(leavingEmployee, currentHour, unfilledClients, remainingScheduledNames, vehicleMap = {}) {
  const log = []
  if (!remainingScheduledNames.length || !unfilledClients.length) return log

  const sortedTargets = [...remainingScheduledNames].sort((a, b) => a.localeCompare(b))
  const load = {}
  sortedTargets.forEach(name => { load[name] = 0 })

  const sorted = [...unfilledClients].sort((a, b) =>
    getVehicleCountLocal(vehicleMap, b) - getVehicleCountLocal(vehicleMap, a)
  )

  sorted.forEach(client => {
    const vehicleCount = getVehicleCountLocal(vehicleMap, client)
    let minEmp = sortedTargets[0]
    sortedTargets.forEach(name => { if (load[name] < load[minEmp]) minEmp = name })
    log.push({ fromEmployee: leavingEmployee, toEmployee: minEmp, client, hour: currentHour })
    load[minEmp] += vehicleCount
  })

  return log
}
