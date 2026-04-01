# Hemfrid DAX Measures Library
## Komplett samling DAX-measures för BI-analys inom hemstädsbranschen

---

## 1. REVENUE & FINANCIAL KPIs

```dax
// === GRUNDLÄGGANDE INTÄKTER ===

Total Revenue = SUM(FactSales[Revenue])

Total Revenue incl VAT = [Total Revenue] * 1.25

RUT Amount = SUM(FactSales[RUT_Amount])

Net Revenue After RUT = [Total Revenue] - [RUT Amount]

Average Order Value = DIVIDE([Total Revenue], [Total Orders])

Average Order Value incl VAT = [Average Order Value] * 1.25

Median Order Value = MEDIAN(FactSales[Revenue])

Revenue per Working Day =
DIVIDE(
    [Total Revenue],
    DISTINCTCOUNT(FactSales[WorkDate])
)

Revenue per Customer =
DIVIDE(
    [Total Revenue],
    [Unique Customers]
)

Gross Margin = DIVIDE([Total Revenue] - [Total Cost], [Total Revenue])

Gross Margin Amount = [Total Revenue] - [Total Cost]

Total Cost = SUM(FactSales[Cost])

Cost per Order = DIVIDE([Total Cost], [Total Orders])

EBITDA = [Gross Margin Amount] - [Total Operating Expenses]

Total Operating Expenses = SUM(FactExpenses[Amount])
```

```dax
// === INTÄKTER PER TJÄNSTETYP ===

Revenue Hemstäd = CALCULATE([Total Revenue], DimService[ServiceType] = "Hemstäd")

Revenue Kontorsstäd = CALCULATE([Total Revenue], DimService[ServiceType] = "Kontorsstäd")

Revenue Flyttstäd = CALCULATE([Total Revenue], DimService[ServiceType] = "Flyttstäd")

Revenue Fönsterputs = CALCULATE([Total Revenue], DimService[ServiceType] = "Fönsterputs")

Revenue Storstäd = CALCULATE([Total Revenue], DimService[ServiceType] = "Storstäd")

Revenue Trappstäd = CALCULATE([Total Revenue], DimService[ServiceType] = "Trappstäd")

Share of Revenue by Service =
DIVIDE(
    [Total Revenue],
    CALCULATE([Total Revenue], REMOVEFILTERS(DimService))
)

Most Popular Service =
FIRSTNONBLANK(
    TOPN(1, VALUES(DimService[ServiceType]), [Total Orders], DESC),
    1
)
```

```dax
// === TIDSINTELLIGENS — YoY / MoM / YTD ===

Revenue PY = CALCULATE([Total Revenue], DATEADD(DimDate[Date], -1, YEAR))

Revenue YoY Change = [Total Revenue] - [Revenue PY]

Revenue YoY % = DIVIDE([Revenue YoY Change], [Revenue PY])

Revenue PM = CALCULATE([Total Revenue], DATEADD(DimDate[Date], -1, MONTH))

Revenue MoM Change = [Total Revenue] - [Revenue PM]

Revenue MoM % = DIVIDE([Revenue MoM Change], [Revenue PM])

Revenue YTD = TOTALYTD([Total Revenue], DimDate[Date])

Revenue YTD PY = CALCULATE([Revenue YTD], DATEADD(DimDate[Date], -1, YEAR))

Revenue YTD Growth % = DIVIDE([Revenue YTD] - [Revenue YTD PY], [Revenue YTD PY])

Revenue Rolling 3M =
CALCULATE(
    [Total Revenue],
    DATESINPERIOD(DimDate[Date], MAX(DimDate[Date]), -3, MONTH)
)

Revenue Rolling 12M =
CALCULATE(
    [Total Revenue],
    DATESINPERIOD(DimDate[Date], MAX(DimDate[Date]), -12, MONTH)
)

Revenue Rolling 3M PY =
CALCULATE(
    [Revenue Rolling 3M],
    DATEADD(DimDate[Date], -1, YEAR)
)

Revenue CAGR =
VAR StartValue = CALCULATE([Total Revenue], FIRSTDATE(DimDate[Date]))
VAR EndValue = CALCULATE([Total Revenue], LASTDATE(DimDate[Date]))
VAR Years = DATEDIFF(MIN(DimDate[Date]), MAX(DimDate[Date]), YEAR)
RETURN
IF(
    Years > 0 && StartValue > 0,
    POWER(DIVIDE(EndValue, StartValue), DIVIDE(1, Years)) - 1,
    BLANK()
)

Revenue MTD = TOTALMTD([Total Revenue], DimDate[Date])

Revenue QTD = TOTALQTD([Total Revenue], DimDate[Date])

Revenue Same Weekday PY =
CALCULATE(
    [Total Revenue],
    DATEADD(DimDate[Date], -364, DAY)
)
```

---

## 2. ORDERS & BOOKINGS

```dax
// === ORDERS & BOOKINGS ===

Total Orders = COUNTROWS(FactSales)

Total Completed Orders = CALCULATE(COUNTROWS(FactSales), FactSales[Status] = "Completed")

Total Cancelled Orders = CALCULATE(COUNTROWS(FactSales), FactSales[Status] = "Cancelled")

Cancellation Rate = DIVIDE([Total Cancelled Orders], [Total Orders])

Completion Rate = DIVIDE([Total Completed Orders], [Total Orders])

Orders PY = CALCULATE([Total Orders], DATEADD(DimDate[Date], -1, YEAR))

Orders YoY % = DIVIDE([Total Orders] - [Orders PY], [Orders PY])

Orders per Day = DIVIDE([Total Orders], DISTINCTCOUNT(DimDate[Date]))

Orders per Week = [Orders per Day] * 7

Peak Day Orders =
MAXX(
    SUMMARIZE(FactSales, DimDate[Date], "DayOrders", [Total Orders]),
    [DayOrders]
)

Average Orders per Customer =
DIVIDE([Total Orders], [Unique Customers])

First Time Orders =
CALCULATE(
    COUNTROWS(FactSales),
    FILTER(
        FactSales,
        FactSales[OrderDate] = CALCULATE(
            MIN(FactSales[OrderDate]),
            ALLEXCEPT(FactSales, FactSales[CustomerID])
        )
    )
)

Repeat Orders = [Total Orders] - [First Time Orders]

Repeat Order Rate = DIVIDE([Repeat Orders], [Total Orders])

Recurring Subscription Orders =
CALCULATE(COUNTROWS(FactSales), FactSales[IsRecurring] = TRUE())

Recurring Revenue = CALCULATE([Total Revenue], FactSales[IsRecurring] = TRUE())

Recurring Revenue Share = DIVIDE([Recurring Revenue], [Total Revenue])

Average Lead Time Days =
AVERAGEX(
    FactSales,
    DATEDIFF(FactSales[BookingDate], FactSales[ServiceDate], DAY)
)
```

---

## 3. CUSTOMER ANALYTICS

```dax
// === KUNDANALYS — GRUNDLÄGGANDE ===

Unique Customers = DISTINCTCOUNT(FactSales[CustomerID])

New Customers =
CALCULATE(
    DISTINCTCOUNT(FactSales[CustomerID]),
    FILTER(
        VALUES(FactSales[CustomerID]),
        CALCULATE(
            MIN(FactSales[OrderDate]),
            ALLEXCEPT(FactSales, FactSales[CustomerID])
        ) >= MIN(DimDate[Date])
        && CALCULATE(
            MIN(FactSales[OrderDate]),
            ALLEXCEPT(FactSales, FactSales[CustomerID])
        ) <= MAX(DimDate[Date])
    )
)

Returning Customers = [Unique Customers] - [New Customers]

New Customer Rate = DIVIDE([New Customers], [Unique Customers])

Returning Customer Rate = DIVIDE([Returning Customers], [Unique Customers])

Customer Retention Rate =
VAR CustomersStart = CALCULATE(
    DISTINCTCOUNT(FactSales[CustomerID]),
    DATEADD(DimDate[Date], -1, YEAR)
)
VAR CustomersRetained = CALCULATE(
    DISTINCTCOUNT(FactSales[CustomerID]),
    FILTER(
        VALUES(FactSales[CustomerID]),
        CALCULATE(MIN(FactSales[OrderDate]), ALLEXCEPT(FactSales, FactSales[CustomerID]))
        < MIN(DimDate[Date])
    )
)
RETURN DIVIDE(CustomersRetained, CustomersStart)

Customer Churn Rate = 1 - [Customer Retention Rate]

Customer Lifetime Value =
[Average Order Value] * [Average Orders per Customer] * [Gross Margin]

Revenue from New Customers =
CALCULATE(
    [Total Revenue],
    FILTER(
        FactSales,
        FactSales[OrderDate] = CALCULATE(
            MIN(FactSales[OrderDate]),
            ALLEXCEPT(FactSales, FactSales[CustomerID])
        )
    )
)

Revenue from Returning Customers = [Total Revenue] - [Revenue from New Customers]

Customers with Multiple Services =
CALCULATE(
    DISTINCTCOUNT(FactSales[CustomerID]),
    FILTER(
        SUMMARIZE(FactSales, FactSales[CustomerID], "ServiceCount", DISTINCTCOUNT(FactSales[ServiceTypeID])),
        [ServiceCount] > 1
    )
)

Cross-Sell Rate = DIVIDE([Customers with Multiple Services], [Unique Customers])

Average Customer Tenure Days =
AVERAGEX(
    VALUES(FactSales[CustomerID]),
    DATEDIFF(
        CALCULATE(MIN(FactSales[OrderDate]), ALLEXCEPT(FactSales, FactSales[CustomerID])),
        TODAY(),
        DAY
    )
)

Top 10% Customer Revenue =
CALCULATE(
    [Total Revenue],
    TOPN(
        DIVIDE(DISTINCTCOUNT(FactSales[CustomerID]), 10),
        VALUES(FactSales[CustomerID]),
        CALCULATE([Total Revenue]),
        DESC
    )
)

Top 10% Revenue Share = DIVIDE([Top 10% Customer Revenue], [Total Revenue])
```

```dax
// === KUNDSEGMENTERING & RISKANALYS ===

Days Since Last Order =
DATEDIFF(MAX(FactSales[OrderDate]), TODAY(), DAY)

At Risk Customers =
CALCULATE(
    DISTINCTCOUNT(FactSales[CustomerID]),
    FILTER(
        VALUES(FactSales[CustomerID]),
        CALCULATE(DATEDIFF(MAX(FactSales[OrderDate]), TODAY(), DAY)) > 90
        && CALCULATE(DATEDIFF(MAX(FactSales[OrderDate]), TODAY(), DAY)) <= 180
    )
)

Lost Customers =
CALCULATE(
    DISTINCTCOUNT(FactSales[CustomerID]),
    FILTER(
        VALUES(FactSales[CustomerID]),
        CALCULATE(DATEDIFF(MAX(FactSales[OrderDate]), TODAY(), DAY)) > 180
    )
)

Customer Segment =
SWITCH(
    TRUE(),
    [Days Since Last Order] <= 30 && [Total Orders] >= 6, "VIP",
    [Days Since Last Order] <= 60 && [Total Orders] >= 3, "Loyal",
    [Days Since Last Order] <= 30, "Active",
    [Days Since Last Order] <= 90, "At Risk",
    [Days Since Last Order] <= 180, "Dormant",
    "Lost"
)

NPS Score = 
VAR Promoters = CALCULATE(COUNTROWS(FactSurveys), FactSurveys[Score] >= 9)
VAR Detractors = CALCULATE(COUNTROWS(FactSurveys), FactSurveys[Score] <= 6)
VAR TotalResponses = COUNTROWS(FactSurveys)
RETURN
DIVIDE(Promoters - Detractors, TotalResponses) * 100

Average Satisfaction Score = AVERAGE(FactSurveys[Score])

Complaint Rate = DIVIDE(
    CALCULATE(COUNTROWS(FactComplaints)),
    [Total Orders]
)
```

---

## 4. WORKFORCE & OPERATIONS

```dax
// === WORKFORCE & OPERATIONS ===

Total Employees = DISTINCTCOUNT(DimEmployee[EmployeeID])

Active Employees =
CALCULATE(
    DISTINCTCOUNT(DimEmployee[EmployeeID]),
    DimEmployee[IsActive] = TRUE()
)

Revenue per Employee = DIVIDE([Total Revenue], [Active Employees])

Orders per Employee = DIVIDE([Total Orders], [Active Employees])

Average Hours per Order = AVERAGEX(FactSales, FactSales[ServiceHours])

Total Service Hours = SUM(FactSales[ServiceHours])

Revenue per Service Hour = DIVIDE([Total Revenue], [Total Service Hours])

Cost per Service Hour = DIVIDE([Total Cost], [Total Service Hours])

Utilization Rate =
DIVIDE(
    [Total Service Hours],
    [Active Employees] * 8 * DISTINCTCOUNT(DimDate[WorkingDay])
)

Average Employee Rating = AVERAGE(FactSurveys[EmployeeRating])

Employee Turnover Rate =
VAR TerminatedCount = CALCULATE(
    DISTINCTCOUNT(DimEmployee[EmployeeID]),
    DimEmployee[TerminationDate] <> BLANK()
)
VAR AvgHeadcount = DIVIDE([Active Employees] + TerminatedCount + [Active Employees], 2)
RETURN DIVIDE(TerminatedCount, AvgHeadcount)

Sick Leave Rate =
DIVIDE(
    SUM(FactAttendance[SickDays]),
    SUM(FactAttendance[WorkingDays])
)

Average Travel Time Minutes = AVERAGE(FactSales[TravelTimeMinutes])

On Time Completion Rate =
DIVIDE(
    CALCULATE(COUNTROWS(FactSales), FactSales[CompletedOnTime] = TRUE()),
    [Total Completed Orders]
)

Rescheduled Orders =
CALCULATE(COUNTROWS(FactSales), FactSales[WasRescheduled] = TRUE())

Reschedule Rate = DIVIDE([Rescheduled Orders], [Total Orders])

Overtime Hours = CALCULATE(SUM(FactAttendance[Hours]), FactAttendance[IsOvertime] = TRUE())

Overtime Rate = DIVIDE([Overtime Hours], [Total Service Hours])

Team Capacity =
[Active Employees] * 8 * DISTINCTCOUNT(DimDate[WorkingDay])

Capacity Utilization Gap = [Team Capacity] - [Total Service Hours]

Orders per Team =
DIVIDE([Total Orders], DISTINCTCOUNT(DimEmployee[TeamID]))
```

---

## 5. GEOGRAPHIC ANALYSIS

```dax
// === GEOGRAFISK ANALYS ===

Revenue by Region =
CALCULATE([Total Revenue], VALUES(DimRegion[Region]))

Unique Customers by Region =
CALCULATE([Unique Customers], VALUES(DimRegion[Region]))

Revenue per Capita by Region =
DIVIDE([Total Revenue], SUM(DimRegion[Population]))

Market Penetration =
DIVIDE(
    [Unique Customers],
    SUM(DimRegion[TotalHouseholds])
) * 100

Region Revenue Share =
DIVIDE(
    [Total Revenue],
    CALCULATE([Total Revenue], REMOVEFILTERS(DimRegion))
)

Region Revenue Rank =
RANKX(ALL(DimRegion[Region]), [Total Revenue],, DESC, DENSE)

Fastest Growing Region =
FIRSTNONBLANK(
    TOPN(1, VALUES(DimRegion[Region]), [Revenue YoY %], DESC),
    1
)

Average Distance to Customer km = AVERAGE(FactSales[DistanceKm])

Revenue per km2 =
DIVIDE([Total Revenue], SUM(DimRegion[AreaKm2]))

New Markets Revenue =
CALCULATE(
    [Total Revenue],
    FILTER(
        DimRegion,
        DimRegion[LaunchDate] >= DATE(YEAR(TODAY()), 1, 1)
    )
)
```

---

## 6. RUT-SPECIFIC MEASURES

```dax
// === RUT-SPECIFIKA MEASURES ===

Total RUT Deduction = SUM(FactSales[RUT_Amount])

RUT per Customer = DIVIDE([Total RUT Deduction], [Unique Customers])

RUT per Order = DIVIDE([Total RUT Deduction], [Total Orders])

RUT Share of Revenue = DIVIDE([Total RUT Deduction], [Total Revenue])

Customer Price After RUT = [Average Order Value] - [RUT per Order]

RUT Eligible Revenue =
CALCULATE([Total Revenue], FactSales[IsRUTEligible] = TRUE())

RUT Utilization Rate =
DIVIDE([RUT Eligible Revenue], [Total Revenue])

Average RUT Percentage =
AVERAGEX(FactSales, DIVIDE(FactSales[RUT_Amount], FactSales[Revenue]))

RUT YoY Change = [Total RUT Deduction] - CALCULATE([Total RUT Deduction], DATEADD(DimDate[Date], -1, YEAR))

RUT YoY % =
DIVIDE(
    [RUT YoY Change],
    CALCULATE([Total RUT Deduction], DATEADD(DimDate[Date], -1, YEAR))
)

Max RUT per Customer per Year = 75000

RUT Headroom per Customer =
[Max RUT per Customer per Year] - [RUT per Customer]

Customers Near RUT Cap =
CALCULATE(
    DISTINCTCOUNT(FactSales[CustomerID]),
    FILTER(
        SUMMARIZE(FactSales, FactSales[CustomerID], "YearlyRUT", SUM(FactSales[RUT_Amount])),
        [YearlyRUT] >= 60000
    )
)
```

---

## 7. SEASONAL & TREND ANALYSIS

```dax
// === SÄSONG & TRENDANALYS ===

Revenue by Weekday =
CALCULATE([Total Revenue], VALUES(DimDate[DayOfWeekName]))

Most Profitable Weekday =
FIRSTNONBLANK(
    TOPN(1, VALUES(DimDate[DayOfWeekName]), [Total Revenue], DESC),
    1
)

Seasonality Index =
DIVIDE(
    [Total Revenue],
    [Revenue Rolling 12M] / 12
)

Revenue by Quarter =
CALCULATE([Total Revenue], VALUES(DimDate[Quarter]))

Summer Dip Impact =
VAR SummerRevenue = CALCULATE([Total Revenue], DimDate[Month] IN {6, 7, 8})
VAR AvgQuarterRevenue = [Revenue Rolling 12M] / 4
RETURN DIVIDE(SummerRevenue - AvgQuarterRevenue, AvgQuarterRevenue)

Peak Month Revenue =
MAXX(
    SUMMARIZE(FactSales, DimDate[YearMonth], "MonthRev", [Total Revenue]),
    [MonthRev]
)

Holiday Impact =
CALCULATE(
    [Total Revenue],
    DimDate[IsHoliday] = TRUE()
)

Pre-Holiday Surge =
CALCULATE(
    [Total Revenue],
    FILTER(
        DimDate,
        DimDate[DaysToNextHoliday] >= 1 && DimDate[DaysToNextHoliday] <= 7
    )
)

Week Number Revenue =
CALCULATE([Total Revenue], VALUES(DimDate[WeekNumber]))

Moving Average 4 Weeks =
CALCULATE(
    [Total Revenue],
    DATESINPERIOD(DimDate[Date], MAX(DimDate[Date]), -28, DAY)
) / 4

Trend Direction =
VAR CurrentMonth = [Total Revenue]
VAR PreviousMonth = [Revenue PM]
VAR TwoMonthsAgo = CALCULATE([Total Revenue], DATEADD(DimDate[Date], -2, MONTH))
RETURN
SWITCH(
    TRUE(),
    CurrentMonth > PreviousMonth && PreviousMonth > TwoMonthsAgo, "↑ Accelerating",
    CurrentMonth > PreviousMonth, "↑ Growing",
    CurrentMonth < PreviousMonth && PreviousMonth < TwoMonthsAgo, "↓ Declining",
    CurrentMonth < PreviousMonth, "↓ Slowing",
    "→ Stable"
)
```

---

## 8. MARKETING & ACQUISITION

```dax
// === MARKETING & ACQUISITION ===

Customer Acquisition Cost =
DIVIDE(
    SUM(FactMarketingSpend[Amount]),
    [New Customers]
)

Marketing ROI =
DIVIDE(
    [Revenue from New Customers] - SUM(FactMarketingSpend[Amount]),
    SUM(FactMarketingSpend[Amount])
)

Cost per Lead = DIVIDE(SUM(FactMarketingSpend[Amount]), SUM(FactLeads[LeadCount]))

Lead Conversion Rate = DIVIDE([New Customers], SUM(FactLeads[LeadCount]))

Revenue per Marketing Krona =
DIVIDE([Total Revenue], SUM(FactMarketingSpend[Amount]))

Channel Revenue Share =
DIVIDE(
    [Total Revenue],
    CALCULATE([Total Revenue], REMOVEFILTERS(DimChannel))
)

Best Performing Channel =
FIRSTNONBLANK(
    TOPN(1, VALUES(DimChannel[ChannelName]), [Total Revenue], DESC),
    1
)

Referral Revenue =
CALCULATE([Total Revenue], DimChannel[ChannelName] = "Referral")

Referral Rate =
DIVIDE(
    CALCULATE([New Customers], DimChannel[ChannelName] = "Referral"),
    [New Customers]
)

Website Conversion Rate =
DIVIDE([Total Orders], SUM(FactWebTraffic[Sessions]))

Organic vs Paid Revenue Ratio =
DIVIDE(
    CALCULATE([Total Revenue], DimChannel[IsPaid] = FALSE()),
    CALCULATE([Total Revenue], DimChannel[IsPaid] = TRUE())
)

Payback Period Months =
DIVIDE(
    [Customer Acquisition Cost],
    [Revenue per Customer] / 12 * [Gross Margin]
)
```

---

## 9. QUALITY & COMPLAINTS

```dax
// === KVALITET & KLAGOMÅL ===

Total Complaints = COUNTROWS(FactComplaints)

Complaints per 100 Orders = DIVIDE([Total Complaints], [Total Orders]) * 100

Complaint Resolution Rate =
DIVIDE(
    CALCULATE(COUNTROWS(FactComplaints), FactComplaints[IsResolved] = TRUE()),
    [Total Complaints]
)

Average Resolution Time Hours =
AVERAGEX(
    FactComplaints,
    DATEDIFF(FactComplaints[CreatedDate], FactComplaints[ResolvedDate], HOUR)
)

Redo Rate =
DIVIDE(
    CALCULATE(COUNTROWS(FactSales), FactSales[IsRedo] = TRUE()),
    [Total Completed Orders]
)

Cost of Quality Issues =
CALCULATE(
    SUM(FactSales[Cost]),
    FactSales[IsRedo] = TRUE()
)

Complaint Trend =
VAR CurrentPeriod = [Total Complaints]
VAR PreviousPeriod = CALCULATE([Total Complaints], DATEADD(DimDate[Date], -1, MONTH))
RETURN DIVIDE(CurrentPeriod - PreviousPeriod, PreviousPeriod)

Most Common Complaint Category =
FIRSTNONBLANK(
    TOPN(1, VALUES(FactComplaints[Category]), COUNTROWS(FactComplaints), DESC),
    1
)

Service Quality Score =
(1 - [Redo Rate]) * 0.4 +
(1 - [Complaint Rate]) * 0.3 +
[On Time Completion Rate] * 0.3
```

---

## 10. FORECASTING & TARGETS

```dax
// === FORECASTING & TARGETS ===

Revenue Target = SUM(FactTargets[TargetRevenue])

Revenue vs Target = [Total Revenue] - [Revenue Target]

Revenue vs Target % = DIVIDE([Revenue vs Target], [Revenue Target])

Target Achievement = DIVIDE([Total Revenue], [Revenue Target])

Target Achievement Status =
SWITCH(
    TRUE(),
    [Target Achievement] >= 1.1, "🟢 Exceeding (+10%)",
    [Target Achievement] >= 1, "🟢 On Target",
    [Target Achievement] >= 0.9, "🟡 Close (-10%)",
    "🔴 Behind"
)

Orders Target = SUM(FactTargets[TargetOrders])

Orders vs Target % = DIVIDE([Total Orders] - [Orders Target], [Orders Target])

Run Rate Annual =
[Total Revenue] / DATEDIFF(MIN(DimDate[Date]), MAX(DimDate[Date]), DAY) * 365

Projected Year End Revenue =
[Revenue YTD] + ([Revenue Rolling 3M] / 3) * (12 - MONTH(MAX(DimDate[Date])))

Days to Target =
VAR DailyRate = [Revenue per Working Day]
VAR Remaining = [Revenue Target] - [Total Revenue]
RETURN IF(DailyRate > 0, DIVIDE(Remaining, DailyRate), BLANK())

Gap to Target = MAX(0, [Revenue Target] - [Total Revenue])

Required Daily Revenue to Hit Target =
DIVIDE(
    [Gap to Target],
    CALCULATE(
        DISTINCTCOUNT(DimDate[Date]),
        DimDate[Date] > TODAY() && DimDate[Date] <= EOMONTH(TODAY(), 0)
    )
)
```

---

## 11. COMPARATIVE & RANKING

```dax
// === COMPARATIVE & RANKING ===

Revenue Rank by Service =
RANKX(ALL(DimService[ServiceType]), [Total Revenue],, DESC, DENSE)

Revenue Rank by Region =
RANKX(ALL(DimRegion[Region]), [Total Revenue],, DESC, DENSE)

Revenue Rank by Employee =
RANKX(ALL(DimEmployee[EmployeeName]), [Total Revenue],, DESC, DENSE)

Percentile Rank =
DIVIDE(
    COUNTROWS(
        FILTER(
            ALL(DimRegion[Region]),
            CALCULATE([Total Revenue]) < [Total Revenue]
        )
    ),
    COUNTROWS(ALL(DimRegion[Region]))
)

Above Average Flag =
IF(
    [Total Revenue] > CALCULATE([Total Revenue], ALL()) / DISTINCTCOUNT(DimRegion[Region]),
    "Above Average",
    "Below Average"
)

Pareto 80/20 Flag =
VAR CurrentRank = [Revenue Rank by Service]
VAR TotalItems = COUNTROWS(ALL(DimService[ServiceType]))
RETURN IF(CurrentRank <= TotalItems * 0.2, "Top 20%", "Bottom 80%")

Index vs Company Average =
DIVIDE(
    [Revenue per Employee],
    CALCULATE([Revenue per Employee], ALL())
) * 100

Best Month Ever =
MAXX(
    SUMMARIZE(ALL(DimDate), DimDate[YearMonth], "Rev", [Total Revenue]),
    [Rev]
)

Current Month vs Best Ever =
DIVIDE([Total Revenue], [Best Month Ever])
```

---

## 12. HELPER / UTILITY MEASURES

```dax
// === HELPER & UTILITY MEASURES ===

Latest Data Date = MAX(FactSales[OrderDate])

Days Since Last Refresh = DATEDIFF([Latest Data Date], TODAY(), DAY)

Data Freshness Alert =
IF([Days Since Last Refresh] > 2, "⚠️ Data is " & [Days Since Last Refresh] & " days old", "✅ Data is current")

Selected Period Label =
FORMAT(MIN(DimDate[Date]), "YYYY-MM-DD") & " to " & FORMAT(MAX(DimDate[Date]), "YYYY-MM-DD")

Is Current Year = IF(YEAR(MAX(DimDate[Date])) = YEAR(TODAY()), TRUE(), FALSE())

Is Current Month = IF(YEAR(MAX(DimDate[Date])) = YEAR(TODAY()) && MONTH(MAX(DimDate[Date])) = MONTH(TODAY()), TRUE(), FALSE())

Formatted Revenue = FORMAT([Total Revenue], "#,##0 kr")

Formatted Percentage = FORMAT([Revenue YoY %], "+0.0%;-0.0%;0.0%")

Dynamic Title Revenue =
"Revenue: " & FORMAT([Total Revenue], "#,##0 kr") &
" (" & FORMAT([Revenue YoY %], "+0.0%;-0.0%") & " YoY)"

Conditional Formatting Value =
SWITCH(
    TRUE(),
    [Revenue YoY %] >= 0.1, 3,
    [Revenue YoY %] >= 0, 2,
    [Revenue YoY %] >= -0.1, 1,
    0
)

KPI Arrow = 
SWITCH(
    TRUE(),
    [Revenue MoM %] > 0.05, "▲",
    [Revenue MoM %] > 0, "△",
    [Revenue MoM %] > -0.05, "▽",
    "▼"
)

Blank Row Handler =
IF(ISBLANK([Total Revenue]), 0, [Total Revenue])
```

---

*Totalt: 150+ DAX-measures organiserade i 12 kategorier*
*Anpassade för hemstädsbranschen med RUT-avdrag, workforce management, kundanalys och seasonal patterns*
